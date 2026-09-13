import { fonts } from '../appearance/fonts.ts';
import { presets } from '../appearance/presets.ts';

// What the Settings search matches against: one entry per section and one per field, each a
// bag of lower-case words (its label, the gist of its hint, and the words an operator might
// try instead). The index is by hand, so `settings-view.test.ts` checks it against what the
// screen renders: every `data-setting` on the screen is an entry here and every entry is on
// the screen, every labelled control sits inside a field entry or a whole-section editor, and
// every word of a label is a word of its entry, so a new field cannot be unfindable.

export type SettingsSectionId =
  | 'devices'
  | 'this-device'
  | 'appearance'
  | 'flux'
  | 'agents'
  | 'skills'
  | 'harness-config';

export interface SettingsEntry {
  id: string;
  // The section a field sits in; null for a section itself.
  section: SettingsSectionId | null;
  terms: readonly string[];
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== '');

const section = (id: SettingsSectionId, terms: string): SettingsEntry => ({
  id,
  section: null,
  terms: words(terms),
});
const field = (parent: SettingsSectionId, id: string, terms: string): SettingsEntry => ({
  id,
  section: parent,
  terms: words(terms),
});

// The names the pickers offer, so a theme or a font is found by its own name.
const themeNames = Object.values(presets)
  .map((theme) => theme.name)
  .join(' ');
const fontNames = (part: 'text' | 'code'): string => fonts.families[part].join(' ');

// The editors (agents, skills, harness config) are whole sections: hiding a row of one would
// hide an unsaved edit, so their fields are words on the section entry.
const entries: readonly SettingsEntry[] = [
  section('devices', 'devices paired phone laptop'),
  field('devices', 'devices-list', 'devices list revoke remove paired last seen this device'),
  field('devices', 'devices-pair', 'pair another device qr code scan flux pair'),
  section('this-device', 'this device keyboard'),
  field('this-device', 'flux-sound', 'notification sound ring alert chime volume mute play'),
  field(
    'this-device',
    'flux-send-key',
    'send with enter return key newline new line shift ctrl cmd command modifier keyboard',
  ),
  field(
    'this-device',
    'flux-switch-key',
    'switch tabs with chord session tabs keyboard shortcut arrow ctrl alt option next previous',
  ),
  section('appearance', 'appearance look colours colors'),
  field('appearance', 'flux-mode', 'light or dark mode system scheme night'),
  field(
    'appearance',
    'flux-theme',
    `theme preset default copy paste json colours colors ${themeNames}`,
  ),
  field('appearance', 'flux-font-text', `text font family typeface system ${fontNames('text')}`),
  field(
    'appearance',
    'flux-font-code',
    `code font family typeface monospace system ${fontNames('code')}`,
  ),
  field('appearance', 'flux-font-size', 'text size font size px slider zoom bigger smaller'),
  section('flux', 'flux box daemon'),
  field('flux', 'flux-repos', 'repositories directory repos folder path clone'),
  field('flux', 'flux-harness', 'default harness claude code pi opencode agent'),
  field(
    'flux',
    'flux-notify',
    'notify me when push notifications the agent asks a question goes idle reports done or blocked',
  ),
  field('flux', 'flux-versions', 'daemon version app version build release'),
  field(
    'flux',
    'flux-update',
    'update upgrade release install newer verified check up to date current',
  ),
  field(
    'flux',
    'flux-env',
    'relay url data directory daemon name push subject claude command environment',
  ),
  section(
    'agents',
    'agents saved agent add name harness model effort role tools tool names all allow-list allow deny-list deny none manager delete',
  ),
  section('skills', 'skills skill.md add name body slash command instruction file delete'),
  section('harness-config', 'harness config claude.md settings.json global json markdown rules'),
];

// Whether an id is shown under the search's answer: everything while it is null.
const isShown = (visible: ReadonlySet<string> | null, id: string): boolean =>
  visible === null || visible.has(id);

// The ids to show for a query, or null for a blank query (show everything). Every word of the
// query must start a word of the entry: a prefix, so `noti` finds Notification and Notify, and
// `mode` finds Model as well as Mode, but a run of letters inside a word (`ode`) finds nothing.
// A field that matches shows its section's heading too; a section that matches shows all its
// fields, since the operator named the section.
const search = (query: string): ReadonlySet<string> | null => {
  const typed = words(query);
  if (typed.length === 0) return null;
  const matches = (entry: SettingsEntry): boolean =>
    typed.every((word) => entry.terms.some((term) => term.startsWith(word)));
  const sections = new Set(
    entries.filter((e) => e.section === null && matches(e)).map((e) => e.id),
  );
  const shown = new Set<string>(sections);
  for (const entry of entries) {
    if (entry.section === null) continue;
    if (sections.has(entry.section) || matches(entry)) {
      shown.add(entry.id);
      shown.add(entry.section);
    }
  }
  return shown;
};

export const settingsIndex: {
  entries: readonly SettingsEntry[];
  search: typeof search;
  isShown: typeof isShown;
} = { entries, search, isShown };
