// The header's primary navigation, shared by the desktop bar and the mobile sheet.

// href carries the route; labelKey resolves to a common.nav.* translation.
export const navigationItems = [
  { labelKey: 'nav.home', href: '/' },
  // Studio is the create-a-video flow and holds the saved projects; Templates is the template
  // manager/authoring area.
  { labelKey: 'nav.showcase', href: '/showcase' },
  { labelKey: 'nav.studio', href: '/studio' },
  { labelKey: 'nav.templates', href: '/templates' },
  { labelKey: 'nav.docs', href: '/doc' },
  { labelKey: 'nav.about', href: '/about' },
] as const;

export type NavItem = (typeof navigationItems)[number];

/** Whether a nav entry is the current section: its own page or any page below it, and Home on home only. */
export const isNavActive = (pathname: string, href: string): boolean => {
  if (href === '/') return pathname === '/';

  return pathname === href || pathname.startsWith(`${href}/`);
};
