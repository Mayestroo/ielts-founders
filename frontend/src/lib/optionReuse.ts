const normalizeInstruction = (instruction: string): string => {
  return instruction
    .replace(/[*_`~>#\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
};

export const instructionAllowsOptionReuse = (instruction?: string | null): boolean => {
  if (!instruction) {
    return false;
  }

  const normalized = normalizeInstruction(instruction);

  return [
    /you\s+may\s+use\s+(?:any\s+)?(?:letter|letters|option|options)\s+more\s+than\s+once/,
    /(?:letter|letters|option|options)\s+can\s+be\s+used\s+more\s+than\s+once/,
    /(?:re-use|reuse)\s+(?:any\s+)?(?:letter|letters|option|options)/,
  ].some((pattern) => pattern.test(normalized));
};
