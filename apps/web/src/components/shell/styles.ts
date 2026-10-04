/** Class names shared by the server shell and its client frame (a client module cannot export them). */

/** Row of the sidebar: icon + label when expanded, a 40px icon button in the rail. */
export const SHELL_ITEM =
  "flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm rail:justify-center rail:px-0";
/** The label of a row: visible when expanded, kept as the accessible name in the rail. */
export const SHELL_LABEL = "min-w-0 truncate rail:sr-only";
