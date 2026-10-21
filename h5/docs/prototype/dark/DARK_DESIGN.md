---
name: Clinical Calm
colors:
  surface: '#111319'
  surface-dim: '#111319'
  surface-bright: '#373940'
  surface-container-lowest: '#0c0e14'
  surface-container-low: '#191b22'
  surface-container: '#1d1f26'
  surface-container-high: '#282a30'
  surface-container-highest: '#33343b'
  on-surface: '#e2e2ea'
  on-surface-variant: '#c5c5d6'
  inverse-surface: '#e2e2ea'
  inverse-on-surface: '#2e3037'
  outline: '#8f8fa0'
  outline-variant: '#454654'
  surface-tint: '#bcc2ff'
  primary: '#bcc2ff'
  on-primary: '#001999'
  primary-container: '#5668e8'
  on-primary-container: '#fffcff'
  inverse-primary: '#3d50d0'
  secondary: '#bac3ff'
  on-secondary: '#00218d'
  secondary-container: '#1c38b0'
  on-secondary-container: '#a3b0ff'
  tertiary: '#45dfa4'
  on-tertiary: '#003825'
  tertiary-container: '#00865d'
  on-tertiary-container: '#fbfff9'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dfe0ff'
  primary-fixed-dim: '#bcc2ff'
  on-primary-fixed: '#000c61'
  on-primary-fixed-variant: '#2034b8'
  secondary-fixed: '#dee1ff'
  secondary-fixed-dim: '#bac3ff'
  on-secondary-fixed: '#001159'
  on-secondary-fixed-variant: '#1c38b0'
  tertiary-fixed: '#68fcbf'
  tertiary-fixed-dim: '#45dfa4'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#005137'
  background: '#111319'
  on-background: '#e2e2ea'
  surface-variant: '#33343b'
  surface-canvas: '#12141a'
  surface-subground: '#191c24'
  surface-card: '#1e222d'
  surface-elevated: '#252a37'
  border-subtle: '#2d3343'
  border-glass: rgba(255, 255, 255, 0.08)
  text-primary: '#f3f4f6'
  text-secondary: '#9ca3af'
  text-muted: '#6b7280'
  status-success: '#34d399'
  status-success-bg: rgba(16, 185, 129, 0.16)
  status-warning: '#fbbf24'
  status-warning-bg: rgba(245, 158, 11, 0.16)
  status-danger: '#f87171'
  status-danger-bg: rgba(248, 113, 113, 0.16)
  callout-warm-bg: '#382d1c'
  callout-warm-text: '#fcd34d'
  callout-warm-border: '#78521a'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: '0'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: '0'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: '0'
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 1.5rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system delivers an ergonomic, low-strain digital environment tailored for clinical IT support technicians, night-shift nurses, and hospital medical staff under high-stress conditions. The brand persona is calm, ultra-reliable, clinical, and reassuring—designed to eliminate cognitive overload in dim hospital wards, dark ICU hallways, and overnight maintenance shifts.

The aesthetic fuses **Minimalism** with **Tonal Surface Layering** and **Low-Contrast Outlines**. Rather than harsh stark-black contrasts or overly radiant neons, it utilizes velvet slate-charcoal bases, soft luminous borders, and a vibrant Notion-inspired indigo accent to guide the user's focus effortlessly without triggering eye strain or blue-light fatigue.

## Colors

The color palette is engineered specifically for scotopic and mesopic visual conditions (dimly lit clinical rooms). Pure black `#000000` is avoided to prevent halation and glaring optical vibration when paired with bright text.

- **Foundational Surfaces:** Grounded in `#12141a` canvas with `#1e222d` card surfaces, ascending to `#252a37` for elevated interactive modals and popovers.
- **Primary & Interactive Accents:** Notion indigo `#5668e8` delivers clear optical hierarchy, balanced with `#455dd3` for pressed and active states.
- **Triage & Status Indicators:**
  - *Normal / Stable:* `#34d399` over soft forest tints.
  - *Warning / Urgent:* `#fbbf24` amber for rapid issue prioritization.
  - *Emergency / System Failure:* `#f87171` rose-red for critical incidents.
  - *Emergency Hotline & Fast Contact:* Dedicated warm amber chamber (`#382d1c` fill, `#78521a` stroke, `#fcd34d` typography) to command immediate triage contact without visual panic.

## Typography

Typographic scale is constructed entirely using Inter for absolute legibility across dense medical device lists, ticket logs, and technical telemetry charts. 

High-contrast `#f3f4f6` is used strictly for headings, hardware IDs, and active selections. Neutral `#9ca3af` covers descriptive sentences, symptom notes, and instruction details. Muted `#6b7280` is reserved for timestamps, unselected tabs, and secondary metadata, preventing screen glare during nocturnal usage.

## Layout & Spacing

The layout is grounded on a fluid grid optimized for high-velocity handheld triage (mobile ward devices and rugged hospital tablets) as well as desktop telemetry consoles.

- **Mobile Viewports (<640px):** Single-column stack with `1rem` outer canvas padding and compact `0.75rem` gutters to maximize screen space for diagnostic logs.
- **Tablet / Clinical Cart (640px - 1024px):** 6-column fluid structure with `1rem` gutters, supporting split ticket lists and technician repair forms side-by-side.
- **Desktop Dispatch Console (>1024px):** 12-column layout with `1.5rem` margins and `1rem` gutters for multi-pane monitoring.

## Elevation & Depth

Visual depth is achieved through an interplay of **Tonal Layering** and **Low-Contrast Outlines** rather than heavy drop shadows:

- **Surface Floor (`#12141a`):** Base canvas layer for global app screens.
- **Recessed / Secondary Ground (`#191c24`):** Segmented control rails, filter bars, and inactive drawer bodies.
- **Surface Level 1 (`#1e222d` with 1px `#2d3343` or `rgba(255, 255, 255, 0.08)` border):** Standard elevation for inspection cards, repair tickets, and clinical department tiles.
- **Surface Level 2 (`#252a37` with subtle ambient blur):** Popovers, floating triage bars, bottom sheets, and diagnostic modals. Drop shadows are strictly tinted (`rgba(0, 0, 0, 0.45)` with 12px blur) to prevent glowing halation artifacts.

## Shapes

The design uses a clean, ergonomic shape system that aligns directly with medical-grade software conventions:

- **Touch Controls & Data Inputs:** Strictly **8px** border radius (`rounded-md`), offering clear visual definition for buttons, form fields, and dropdown targets.
- **Containers, Modals & Cards:** Formed with **12px** border radius (`rounded-lg`), softening the interface to feel calm, approachable, and human.
- **Pills & Status Chips:** Fully pill-shaped (`9999px`) to immediately distinguish diagnostic tags, online status badges, and device condition indicators from actionable rectangular buttons.

## Components

### Buttons
- **Primary Action (e.g., "Report Fault", "Assign Tech"):** Filled `#5668e8` background with `#ffffff` text, 8px border radius, standard height of 40px (desktop) / 44px (touch). Hover shifts to `#455dd3`.
- **Secondary / Ghost:** `#1e222d` background with 1px border (`#2d3343`) and `#f3f4f6` text. Active press lightens border to `rgba(255, 255, 255, 0.15)`.
- **Urgent Call Action:** `#382d1c` background with `#fcd34d` text and `#78521a` border for rapid hotline calls.

### Input Fields & Search Bars
- Background `#191c24` encased in 1px `#2d3343` border with 8px radius. Text displays in `#f3f4f6`, placeholders in `#6b7280`. Focused state displays a vibrant 1px `#5668e8` border paired with an ergonomic 2px focus ring (`rgba(86, 104, 232, 0.2)`).

### Cards & Service Tickets
- Constructed on `#1e222d` with 12px corner radius, framed by a delicate 1px border (`rgba(255, 255, 255, 0.08)`). Content sections use `1rem` internal padding. Card headers feature status chips on the trailing edge.

### Chips & Badges
- 9999px pill geometry with 4px vertical and 10px horizontal padding.
- *Online / Resolved:* `#34d399` text over `rgba(16, 185, 129, 0.16)`.
- *Pending / In Progress:* `#fbbf24` text over `rgba(245, 158, 11, 0.16)`.
- *Critical / Malfunction:* `#f87171` text over `rgba(248, 113, 113, 0.16)`.

### Checkboxes & Radio Controls
- Base is 18px square (checkbox, 4px radius) or circle (radio) with `#191c24` fill and 1.5px `#2d3343` border. Selected state triggers solid `#5668e8` fill with crisp white checkmark icon.

### Clinical Telemetry & Ticket Lists
- List rows on `#1e222d` separated by 1px hairline dividers (`#2d3343`). Hover states highlight with `#252a37`. Leading edge accommodates asset type icons with trailing status markers and chevron indicators.