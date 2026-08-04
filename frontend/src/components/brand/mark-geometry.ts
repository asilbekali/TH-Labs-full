// Vector geometry for the TH-Labs mark, traced from public/logo.png and
// normalized to a 100×100 viewBox. Shared by LogoMark, LogoLoader and the
// section divider so there is a single source of truth for the paths.

// The main glyph: a rounded square with four rectangular notches cut out
// (even-odd), forming the stylised "T". No fill here — the consumer sets
// currentColor.
export const BODY_PATH =
  'M15.66,13.24 H47.29 A11.66,11.66 0 0 1 58.95,24.9 V79.1 A11.66,11.66 0 0 1 47.29,90.75 ' +
  'H15.66 A11.66,11.66 0 0 1 4,79.1 V24.9 A11.66,11.66 0 0 1 15.66,13.24 Z ' +
  'M47.63,25.31 V38.22 H58.95 V25.31 Z ' +
  'M18.24,41.55 V56.95 H48.63 V41.55 Z ' +
  'M33.22,56.95 V71.11 H58.95 V56.95 Z ' +
  'M33.22,71.11 V90.75 H48.63 V71.11 Z'

export interface Pixel {
  x: number
  y: number
  w: number
  h: number
}

// The detached squares dispersing off the upper-right / lower-right, in draw
// order. rx is a shared subtle corner radius.
export const PIXELS: Pixel[] = [
  { x: 59.03, y: 25.56, w: 11.24, h: 10.66 },
  { x: 70.52, y: 18.07, w: 7.99, h: 7.49 },
  { x: 70.44, y: 37.14, w: 9.66, h: 7.91 },
  { x: 58.95, y: 55.95, w: 15.24, h: 15.15 },
  { x: 80.26, y: 46.05, w: 8.08, h: 7.58 },
  { x: 86.76, y: 25.23, w: 5.33, h: 5.41 },
  { x: 91.5, y: 9.25, w: 4.5, h: 4.41 },
  { x: 82.6, y: 70.52, w: 4.41, h: 4.33 },
  { x: 64.28, y: 82.18, w: 7.74, h: 7.08 },
]

export const PIXEL_RX = 0.83

// Origin the pixels disperse from (centre of the glyph body).
export const BODY_CENTER = { x: 31.5, y: 52 }
