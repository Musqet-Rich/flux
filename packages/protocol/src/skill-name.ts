// A skill's name is a single safe path segment (protocol.md § 7, `skills.*`): the box turns
// it into `<skillsDir>/<name>/SKILL.md`, so anything that could reach outside that one
// directory is rejected before it is ever joined to a path. That means the empty string, the
// `.`/`..` traversal entries, either path separator (`/` or `\`, so an absolute path is
// caught by its leading separator too), and any control character (a NUL or newline that could
// confuse a later consumer). The same guard runs on the wire (`rpcMethods`) and again in the
// box's skills store, so a bad name is `bad_params` and never touches the disk.

// eslint-disable-next-line no-control-regex -- control characters are exactly what we reject
const controlChar = /[\u0000-\u001F\u007F]/u;

const isSkillName = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value !== '.' &&
  value !== '..' &&
  !value.includes('/') &&
  !value.includes('\\') &&
  !controlChar.test(value);

export const skillName: { is: typeof isSkillName } = { is: isSkillName };
