import { projectRelativeImport } from '../../shared/path-imports.ts';
import type { TaskEnvelope } from '../../shared/task-envelope-types.ts';

function parseRules(description: string): {
  requireName: boolean;
  lowerEmail: boolean;
  stripPhone: boolean;
  defaultCompanyUnknown: boolean;
} {
  const normalized = description.toLowerCase();

  return {
    requireName: /name.+(必填|required)/i.test(description) || /name required/.test(normalized),
    lowerEmail: /email.+(转小写|lower)/i.test(description) || /email.+lowercase/.test(normalized),
    stripPhone:
      /phone.+(去掉空格|去掉空格和横线)/i.test(description) ||
      /phone.+(digits only|strip)/.test(normalized),
    defaultCompanyUnknown:
      /company.+unknown/i.test(description) || /company.+defaults to unknown/.test(normalized)
  };
}

export function synthesizeSlotSource(envelope: TaskEnvelope): string {
  if (envelope.mockTemplate) {
    return envelope.mockTemplate;
  }

  const rules = parseRules(envelope.inputContracts.description);
  const steps: string[] = [];

  steps.push("  const name = String(input.name ?? '').trim();");
  if (rules.requireName) {
    steps.push('  if (!name) {');
    steps.push("    throw new Error('customer name is required');");
    steps.push('  }');
  }
  steps.push("  const email = input.email ? String(input.email).trim() : '';");
  if (rules.lowerEmail) {
    steps.push('  const normalizedEmail = email.toLowerCase();');
  } else {
    steps.push('  const normalizedEmail = email;');
  }
  steps.push("  const rawPhone = input.phone ? String(input.phone) : '';");
  if (rules.stripPhone) {
    steps.push("  const normalizedPhone = rawPhone.replace(/[\\s-]+/g, '');");
  } else {
    steps.push('  const normalizedPhone = rawPhone;');
  }
  if (rules.defaultCompanyUnknown) {
    steps.push("  const company = String(input.company ?? '').trim() || 'Unknown';");
  } else {
    steps.push("  const company = String(input.company ?? '').trim();");
  }
  steps.push('  return {');
  steps.push('    name,');
  steps.push('    email: normalizedEmail,');
  steps.push('    phone: normalizedPhone,');
  steps.push('    company');
  steps.push('  };');

  const runtimeDatabasePath = envelope.targetFile.startsWith('source/')
    ? 'project/src/runtime/database.ts'
    : 'src/runtime/database.ts';
  const databaseImport = projectRelativeImport(envelope.targetFile, runtimeDatabasePath);
  return `// @generated task:${envelope.taskId}\nimport type { CustomerInput, NormalizedCustomerInput } from '${databaseImport}';\n\nexport function normalizeCustomerInput(input: CustomerInput): NormalizedCustomerInput {\n${steps.join('\n')}\n}\n`;
}
