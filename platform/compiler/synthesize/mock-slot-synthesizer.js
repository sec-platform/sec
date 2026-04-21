function parseRules(description) {
  return {
    requireName: /name.+必填/.test(description),
    lowerEmail: /email.+转小写/.test(description),
    stripPhone: /phone.+去掉空格/.test(description) || /phone.+去掉空格和横线/.test(description),
    defaultCompanyUnknown: /company.+Unknown/.test(description)
  };
}

export function synthesizeSlotSource(envelope) {
  const rules = parseRules(envelope.inputContracts.description);
  const steps = [];

  steps.push("  const name = String(input.name ?? '').trim();");
  if (rules.requireName) {
    steps.push("  if (!name) {");
    steps.push("    throw new Error('customer name is required');");
    steps.push('  }');
  }
  steps.push("  const email = input.email ? String(input.email).trim() : '';");
  if (rules.lowerEmail) {
    steps.push("  const normalizedEmail = email.toLowerCase();");
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

  return `// @generated task:${envelope.taskId}\nimport type { CustomerInput, NormalizedCustomerInput } from '../src/runtime/database.ts';\n\nexport function normalizeCustomerInput(input: CustomerInput): NormalizedCustomerInput {\n${steps.join('\n')}\n}\n`;
}
