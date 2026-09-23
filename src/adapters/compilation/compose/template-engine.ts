import { CompilerError } from '../../../compiler/errors.ts';
import { renderTemplateString, TEMPLATE_MAX_INPUT_BYTES } from '../../../compiler/templates/render-template-string.ts';
import { resolvePathInside } from "../../../contracts/relative-path.ts";
import {
  decodeExactUtf8,
  readOptionalRetainedOrdinaryFile
} from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { compilerRuntimeResources } from '../../toolchain/runtime/layout.ts';


const TEMPLATES_DIR = compilerRuntimeResources.composeTemplates;

export class TemplateEngine {
  /** Render one retained template file strictly inside the supplied root. */
  public static render(
    templateName: string,
    context: Readonly<Record<string, unknown>>,
    templatesDir: string = TEMPLATES_DIR
  ): string {
    const filePath = resolvePathInside(templatesDir, templateName);
    if (filePath === null) {
      throw new CompilerError(
        'COMPOSE-TEMPLATE-005',
        `Scaffold template path escapes its allowed root: ${templateName}`,
        { templateName }
      );
    }
    const bytes = readOptionalRetainedOrdinaryFile(filePath, `Scaffold template ${templateName}`);
    if (bytes === null) {
      throw new CompilerError('COMPOSE-TEMPLATE-001', `Scaffold template not found: ${filePath}`);
    }
    if (bytes.byteLength > TEMPLATE_MAX_INPUT_BYTES) {
      throw new CompilerError('COMPOSE-TEMPLATE-006', 'Template input exceeds the canonical byte limit', {
        inputBytes: bytes.byteLength,
        maximumBytes: TEMPLATE_MAX_INPUT_BYTES,
        templateName
      });
    }
    return this.renderString(
      decodeExactUtf8(bytes, `Scaffold template ${templateName}`),
      context
    );
  }

  /** Render bounded, exactly paired conditional directives and literal text substitutions. */
  public static renderString(
    content: string,
    context: Readonly<Record<string, unknown>>
  ): string {
    return renderTemplateString(content, context);
  }
}
