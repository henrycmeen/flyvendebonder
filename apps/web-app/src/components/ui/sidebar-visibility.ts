import { createContext, useContext } from "react";

// Heroes outside a sidebar (for example settings) are visible when mounted.
export const SidebarVisibilityContext = createContext(true);
export function useSidebarVisibility() {
  return useContext(SidebarVisibilityContext);
}
