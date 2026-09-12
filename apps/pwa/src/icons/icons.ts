/* oxlint-disable import/max-dependencies -- the icon vocabulary: one import per icon in use, by design */
import archive from '@phosphor-icons/core/regular/archive.svg?path';
import arrowsInLineVertical from '@phosphor-icons/core/regular/arrows-in-line-vertical.svg?path';
import arrowBendUpLeft from '@phosphor-icons/core/regular/arrow-bend-up-left.svg?path';
import arrowClockwise from '@phosphor-icons/core/regular/arrow-clockwise.svg?path';
import arrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?path';
import arrowDown from '@phosphor-icons/core/regular/arrow-down.svg?path';
import arrowLeft from '@phosphor-icons/core/regular/arrow-left.svg?path';
import arrowsClockwise from '@phosphor-icons/core/regular/arrows-clockwise.svg?path';
import bell from '@phosphor-icons/core/regular/bell.svg?path';
import broom from '@phosphor-icons/core/regular/broom.svg?path';
import caretRight from '@phosphor-icons/core/regular/caret-right.svg?path';
import check from '@phosphor-icons/core/regular/check.svg?path';
import checkCircle from '@phosphor-icons/core/regular/check-circle.svg?path';
import circleFill from '@phosphor-icons/core/fill/circle-fill.svg?path';
import copy from '@phosphor-icons/core/regular/copy.svg?path';
import dotsThree from '@phosphor-icons/core/regular/dots-three.svg?path';
import file from '@phosphor-icons/core/regular/file.svg?path';
import floppyDisk from '@phosphor-icons/core/regular/floppy-disk.svg?path';
import folder from '@phosphor-icons/core/regular/folder.svg?path';
import gearSix from '@phosphor-icons/core/regular/gear-six.svg?path';
import gitCommit from '@phosphor-icons/core/regular/git-commit.svg?path';
import gitDiff from '@phosphor-icons/core/regular/git-diff.svg?path';
import gitPullRequest from '@phosphor-icons/core/regular/git-pull-request.svg?path';
import link from '@phosphor-icons/core/regular/link.svg?path';
import paperPlaneRight from '@phosphor-icons/core/regular/paper-plane-right.svg?path';
import paperclip from '@phosphor-icons/core/regular/paperclip.svg?path';
import pencilSimple from '@phosphor-icons/core/regular/pencil-simple.svg?path';
import play from '@phosphor-icons/core/regular/play.svg?path';
import plus from '@phosphor-icons/core/regular/plus.svg?path';
import qrCode from '@phosphor-icons/core/regular/qr-code.svg?path';
import question from '@phosphor-icons/core/regular/question.svg?path';
import robot from '@phosphor-icons/core/regular/robot.svg?path';
import sealCheck from '@phosphor-icons/core/regular/seal-check.svg?path';
import stop from '@phosphor-icons/core/regular/stop.svg?path';
import terminalWindow from '@phosphor-icons/core/regular/terminal-window.svg?path';
import trash from '@phosphor-icons/core/regular/trash.svg?path';
import uploadSimple from '@phosphor-icons/core/regular/upload-simple.svg?path';
import warning from '@phosphor-icons/core/regular/warning.svg?path';
import x from '@phosphor-icons/core/regular/x.svg?path';
import xCircle from '@phosphor-icons/core/regular/x-circle.svg?path';

// Every icon the PWA draws, by the meaning it carries in the UI, not by its picture (ADR 0029):
// a component says `<Icon name="close" />`, and which glyph "close" is lives here once. The
// values are path strings (vite.config.ts `iconPath`), so this map is the whole cost of the icon
// set and adding one is one import and one key.
export const icons = {
  archive,
  attach: paperclip,
  back: arrowLeft,
  bell,
  changes: gitDiff,
  check,
  clear: broom,
  close: x,
  commit: gitCommit,
  compact: arrowsInLineVertical,
  copy,
  discard: arrowCounterClockwise,
  dot: circleFill,
  down: arrowDown,
  edit: pencilSimple,
  failed: xCircle,
  file,
  files: folder,
  forward: caretRight,
  from: arrowLeft,
  help: question,
  menu: dotsThree,
  pair: link,
  play,
  plus,
  pullRequest: gitPullRequest,
  push: uploadSimple,
  qr: qrCode,
  refresh: arrowsClockwise,
  renew: arrowClockwise,
  reply: arrowBendUpLeft,
  reopen: arrowCounterClockwise,
  retry: arrowClockwise,
  runner: terminalWindow,
  save: floppyDisk,
  send: paperPlaneRight,
  settings: gearSix,
  stop,
  succeeded: checkCircle,
  task: robot,
  trash,
  verified: sealCheck,
  warning,
} as const;

export type IconName = keyof typeof icons;
