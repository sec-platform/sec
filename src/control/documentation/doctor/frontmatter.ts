import { z } from 'zod';
import { failureMessage } from '../../../system-architecture/foundation/runtime/failure-inspection.ts';
import { parseYamlValue } from '../../../system-architecture/foundation/runtime/yaml.ts';

export const VALID_STATUS = new Set(['stable', 'active', 'draft', 'historical', 'archive']);
export const ACTIVE_POINTER_STATUS = new Set([...VALID_STATUS, 'conditional']);

export const FRONTMATTER_MAX_INPUT_BYTES = 64 * 1024;
export const FRONTMATTER_MAX_ALIAS_COUNT = 100;

// Only these fields feed this diagnostic projection. Other metadata belongs to
// other document owners and is not rejected, defaulted or executed here.
const frontmatterFields = z.object({
  status: z.string().min(1),
  domain: z.string().optional(),
  'generated-from': z.string().optional()
});

export interface DocsDoctorFrontmatter {
  ok: boolean;
  status?: string;
  domain?: string;
  generatedFrom?: string;
  reason?: string;
}

/** The small delimiter envelope is not another YAML parser. All scalar,
 * comment, duplicate-key, tag, alias and mapping semantics go to the existing
 * strict YAML owner, followed by the existing document status decision.
 */
export function parseFrontmatter(
  content: string,
  validStatus: ReadonlySet<string> = VALID_STATUS
): DocsDoctorFrontmatter {
  const match = content.match(/^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/u);
  if (match === null) return { ok: false,
    reason: content.startsWith('---') ? 'unterminated frontmatter' : 'missing frontmatter' };
  let raw: unknown;
  try {
    raw = parseYamlValue(match[1] ?? '', { label: 'Document frontmatter',
      maximumInputBytes: FRONTMATTER_MAX_INPUT_BYTES,
      maximumAliasCount: FRONTMATTER_MAX_ALIAS_COUNT, stringKeys: true });
  } catch (error) {
    return { ok: false, reason: `invalid frontmatter YAML: ${failureMessage(error)}` };
  }
  const parsed = frontmatterFields.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { ok: false, reason: issue.path[0] === 'status'
      ? 'missing or invalid status' : `invalid frontmatter field ${issue.path.join('.') || '<root>'}` };
  }
  const { status, domain, 'generated-from': generatedFrom } = parsed.data;
  if (!validStatus.has(status)) return { ok: false, reason: `invalid status "${status}"` };
  return { ok: true, status, domain, generatedFrom };
}
