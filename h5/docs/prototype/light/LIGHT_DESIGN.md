---
name: Workspace Foundation
colors:
  surface: '#faf9f8'
  surface-dim: '#dadad9'
  surface-bright: '#faf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f2'
  surface-container: '#efeeed'
  surface-container-high: '#e9e8e7'
  surface-container-highest: '#e3e2e1'
  on-surface: '#1a1c1c'
  on-surface-variant: '#444653'
  inverse-surface: '#2f3130'
  inverse-on-surface: '#f1f0ef'
  outline: '#757685'
  outline-variant: '#c5c5d6'
  surface-tint: '#3a53c9'
  primary: '#2943b9'
  on-primary: '#ffffff'
  primary-container: '#455dd3'
  on-primary-container: '#e5e6ff'
  inverse-primary: '#bac3ff'
  secondary: '#005eb4'
  on-secondary: '#ffffff'
  secondary-container: '#4093fe'
  on-secondary-container: '#002c5a'
  tertiary: '#823c00'
  on-tertiary: '#ffffff'
  tertiary-container: '#a74f00'
  on-tertiary-container: '#ffe2d3'
  error: '#f64932'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dee1ff'
  primary-fixed-dim: '#bac3ff'
  on-primary-fixed: '#001159'
  on-primary-fixed-variant: '#1c38b0'
  secondary-fixed: '#d5e3ff'
  secondary-fixed-dim: '#a8c8ff'
  on-secondary-fixed: '#001b3c'
  on-secondary-fixed-variant: '#00468a'
  tertiary-fixed: '#ffdbc8'
  tertiary-fixed-dim: '#ffb68a'
  on-tertiary-fixed: '#321300'
  on-tertiary-fixed-variant: '#743500'
  background: '#faf9f8'
  on-background: '#1a1c1c'
  surface-variant: '#e3e2e1'
  accent: '#213183'
  surface-base: '#ffffff'
  text-main: '#191918'
  border-base: rgba(0, 0, 0, 0.1)
  success: '#14832b'
  warning: '#ff6d00'
typography:
  headline-lg:
    fontFamily: Inter, -apple-system, sans-serif
    fontSize: 64px
    fontWeight: '700'
    lineHeight: 64px
    letterSpacing: -2.125px
  headline-md:
    fontFamily: Inter, -apple-system, sans-serif
    fontSize: 54px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -1.875px
  headline-sm:
    fontFamily: Inter, -apple-system, sans-serif
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.625px
  body-md:
    fontFamily: Inter, -apple-system, sans-serif
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: normal
  caption:
    fontFamily: Inter, -apple-system, sans-serif
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.125px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 28px
  margin: 24px
  space-xs: 4px
  space-sm: 8px
  space-md: 16px
  space-lg: 24px
  space-xl: 40px
---

## Brand & Style

This design system embodies a modern, workspace-oriented aesthetic that balances technical utility with editorial polish. The brand personality is professional, structured, and focused, fostering clarity and deep focus through an uncluttered interface. 

The visual style leans toward a refined form of **Minimalism** enhanced by delicate **Ambient Shadows** and soft, multi-layered depth rather than heavy outlines. Content takes center stage, supported by a 12-column fluid grid, generous whitespace, and purposeful typographic contrast between clean sans-serif UI elements and expressive serif accents.

## Colors

The color palette is anchored by deep blues and crisp neutrals, engineered to support high-density information architecture without inducing visual fatigue. The primary accent commands attention for key calls to action, while secondary blues handle interactive states and links. 

Surfaces utilize clean whites and very pale neutral grays to establish subtle hierarchy behind cards and dropdown menus. Status colors are reserved for semantic feedback in inline notifications, badges, and code syntax highlighting.

## Typography

Typography establishes an authoritative yet accessible hierarchy. The primary sans-serif family handles all standard UI controls, navigation, and functional text. 

For editorial contexts, quotes, and highlighted callouts, a traditional serif typeface introduces literary warmth. Code blocks and technical elements rely on a fixed-width monospace face to ensure precise alignment and readability.

## Layout & Spacing

The layout is structured around a strict 2px spacing rhythm, scaling predictably from tight inline gaps to expansive section blocks. A 12-column fluid grid organizes content across viewports, utilizing a 28px gutter on desktop layouts and compressing to 12px on mobile screens. 

Outer canvas margins adapt responsively, maintaining breathable whitespace around content containers regardless of device size.

## Elevation & Depth

Depth is communicated primarily through multi-layered ambient shadows rather than structural borders, creating a lightweight, floating feel for interactive surfaces. 

- **Subtle Lift (`--shadow-100`):** Applied to resting cards and minor interactive containers to separate them cleanly from the base surface.
- **Floating Containers (`--shadow-200`):** Used for dropdown menus, tooltips, and hover states, giving elements clear precedence over underlying content.
- **Modals & Popovers (`--shadow-300`):** Features a heavy, multi-layered diffuse shadow with extended blur depth to command total focus over the workspace.

## Shapes

The shape language uses soft, approachable geometry to keep the workspace feeling friendly and modern without sacrificing organizational rigor. 

- **Inputs & Small Controls:** 4px radius (`--border-radius-200`) for precise, compact elements.
- **Buttons, Tabs & Accordions:** 8px radius (`--border-radius-500`) to provide a tactile, comfortable touch target.
- **Cards & Modals:** 12px radius (`--border-radius-card`) for larger structural containers.
- **Pills & Avatars:** Fully rounded (9999px) for status badges and circular elements.

## Components

### Buttons
Primary actions utilize solid brand fills with high-contrast text and an 8px border radius, transitioning smoothly on hover. Secondary actions rely on neutral surface fills with subtle hover states and low-contrast borders.

### Input Fields
Inputs feature a clean 4px border radius, standard internal padding, and a baseline neutral border that darkens on focus, paired with a soft primary-color ring indicator.

### Cards
Cards are structured with a 12px border radius, white background surfaces, and `--shadow-100` elevation, enclosing internal content with consistent padding tokens.

### Checkboxes & Radio Buttons
Built on compact geometry with distinct checked states using the primary brand color and smooth transition timing.

### Chips & Badges
Utilize fully rounded pill shapes (`9999px`) with muted neutral or status-colored backgrounds for tagging, metadata, and status indicators.

### Lists
Clean, list-item rows featuring generous vertical padding, subtle hover background shifts, and integrated icon support on the leading edge.