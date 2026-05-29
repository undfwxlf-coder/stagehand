import { create } from "zustand";

// Cross-component UI coordination. Currently just the mobile search overlay,
// which is triggered from both the header (desktop) and the bottom tab bar
// (mobile) but rendered once inside HeaderSearch.
interface UiState {
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  searchOpen: false,
  setSearchOpen: (v) => set({ searchOpen: v }),
}));
