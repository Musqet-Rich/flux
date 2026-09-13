import type { Theme } from './theme.ts';

// The themes Settings offers besides the default (ADR 0030): two well-known palettes and one
// drawn here, each with a light and a dark side, as much to show what the JSON looks like as
// to be chosen.
//
// Nord's and Solarized's dark sides are the palettes as published, contrast included (Nord's
// red on its background is 3:1; Solarized is famously low), except a colour that would vanish
// outright: Solarized's bright black is its own page, and stands in as its next grey. Their
// light sides are derived: both palettes were drawn for a dark terminal, and their colours do
// not read on a light page, so each is darkened in its own hue until it holds 4.5:1 against
// the page, Solarized's whites, which are its light page, becoming its darks. Where a palette
// has no colour for a token (Nord has no mid grey for muted text, Solarized no third
// background) the nearest mix in its own hues stands in.
//
// Candlelight is for the eyes: by day a warm paper with no white on it anywhere, and by night
// no blue at all, since blue light is what most delays sleep. Its dark side keeps the blue
// byte of every colour at zero, which is stricter than a night-shift filter and leaves only
// the third of the wheel that has no blue, red through amber to green: the text is amber, as
// on an amber terminal, since any paler "warm white" carries blue; the accent orange, danger
// red-orange, warn yellow and ok lime; and the greys become dark ambers. The sixteen ANSI
// colours a command may name are spread along that arc, from red through orange (for blue),
// yellow, yellow-green (for magenta) and chartreuse (for cyan) to green, a normal and its
// bright the same hue or a few degrees off, the bright the lighter; red alone lightens by
// hue, since near the 4.5:1 floor on this page already it has no lighter to go, so its bright
// is a step toward orange. Danger is a red between the two reds and the accent an orange between the
// two oranges, so the app's own colours are not quite a command's. Twelve colours on a third
// of the wheel sit closer than a full palette's: bright red beside orange, and the
// chartreuses beside the greens, are the closest neighbours. Both sides hold the rule
// base.css states for its light side, here on both: text, muted, accent, danger, ok and warn
// at 4.5:1 against the page and both panels, with the accent's own text on it added, and
// every ANSI colour on the page but the two blacks, which on the dark side sit near it by
// design (presets.test.ts holds all of it). The presets are in alphabetical order, which is
// the picker's.

const candlelight: Theme = {
  name: 'Candlelight',
  light: {
    bg: '#f3ead9',
    fg: '#3a2e1c',
    muted: '#6b5636',
    panel: '#f7f0e0',
    'panel-2': '#e7ddc6',
    border: '#d3c5a8',
    accent: '#96460c',
    'accent-fg': '#f7f0e0',
    danger: '#ad2a1a',
    ok: '#3d6a12',
    warn: '#6e5d00',
    ansi: [
      '#3a2e1c',
      '#ad2a1a',
      '#3d6a12',
      '#6e5d00',
      '#3c5f9a',
      '#8a4a7a',
      '#1f7473',
      '#6b5636',
      '#726248',
      '#b03a22',
      '#4d7222',
      '#725c10',
      '#52629a',
      '#84547f',
      '#2f6d70',
      '#2a2115',
    ],
  },
  dark: {
    bg: '#110b00',
    fg: '#ffb000',
    muted: '#b87c00',
    panel: '#1c1300',
    'panel-2': '#281c00',
    border: '#3f2d00',
    accent: '#ff6c00',
    'accent-fg': '#1c1300',
    danger: '#ff3800',
    ok: '#8fd000',
    warn: '#ffe000',
    ansi: [
      '#3a2800',
      '#ff2000',
      '#33b300',
      '#e6cc00',
      '#e05a00',
      '#a8c800',
      '#6bc400',
      '#d99800',
      '#6b4d00',
      '#ff4000',
      '#45d600',
      '#fff000',
      '#ff8000',
      '#c4f000',
      '#80ec00',
      '#ffb000',
    ],
  },
};

const nord: Theme = {
  name: 'Nord',
  light: {
    bg: '#eceff4',
    fg: '#2e3440',
    muted: '#4c566a',
    panel: '#ffffff',
    'panel-2': '#e5e9f0',
    border: '#d8dee9',
    accent: '#506e92',
    'accent-fg': '#eceff4',
    danger: '#a5464f',
    ok: '#4d7638',
    warn: '#87681b',
    ansi: [
      '#3b4252',
      '#a5464f',
      '#4d7638',
      '#87681b',
      '#506e92',
      '#7e6379',
      '#50717b',
      '#4c566a',
      '#5d6778',
      '#a6545c',
      '#607053',
      '#7a6a48',
      '#596f85',
      '#7e6379',
      '#567170',
      '#2e3440',
    ],
  },
  dark: {
    bg: '#2e3440',
    fg: '#eceff4',
    muted: '#a4adc0',
    panel: '#3b4252',
    'panel-2': '#434c5e',
    border: '#4c566a',
    accent: '#88c0d0',
    'accent-fg': '#2e3440',
    danger: '#bf616a',
    ok: '#a3be8c',
    warn: '#ebcb8b',
    ansi: [
      '#3b4252',
      '#bf616a',
      '#a3be8c',
      '#ebcb8b',
      '#81a1c1',
      '#b48ead',
      '#88c0d0',
      '#e5e9f0',
      '#4c566a',
      '#bf616a',
      '#a3be8c',
      '#ebcb8b',
      '#81a1c1',
      '#b48ead',
      '#8fbcbb',
      '#eceff4',
    ],
  },
};

const solarized: Theme = {
  name: 'Solarized',
  light: {
    bg: '#fdf6e3',
    fg: '#586e75',
    muted: '#657b83',
    panel: '#ffffff',
    'panel-2': '#eee8d5',
    border: '#d9d2c0',
    accent: '#2076b2',
    'accent-fg': '#fdf6e3',
    danger: '#d5312e',
    ok: '#687700',
    warn: '#8f6c00',
    ansi: [
      '#073642',
      '#d5312e',
      '#687700',
      '#8f6c00',
      '#2076b2',
      '#c8337c',
      '#217e77',
      '#586e75',
      '#002b36',
      '#c34815',
      '#586e75',
      '#5f747b',
      '#667375',
      '#666ab8',
      '#687272',
      '#002b36',
    ],
  },
  dark: {
    bg: '#002b36',
    fg: '#93a1a1',
    muted: '#839496',
    panel: '#073642',
    'panel-2': '#0d4552',
    border: '#1a4f5c',
    accent: '#268bd2',
    'accent-fg': '#fdf6e3',
    danger: '#dc322f',
    ok: '#859900',
    warn: '#b58900',
    ansi: [
      '#073642',
      '#dc322f',
      '#859900',
      '#b58900',
      '#268bd2',
      '#d33682',
      '#2aa198',
      '#eee8d5',
      '#586e75',
      '#cb4b16',
      '#586e75',
      '#657b83',
      '#839496',
      '#6c71c4',
      '#93a1a1',
      '#fdf6e3',
    ],
  },
};

export const presets: Readonly<Record<'candlelight' | 'nord' | 'solarized', Theme>> = {
  candlelight,
  nord,
  solarized,
};
