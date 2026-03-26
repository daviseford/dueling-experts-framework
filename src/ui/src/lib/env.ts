export const isMock =
  import.meta.env.VITE_MOCK === "true" ||
  new URLSearchParams(window.location.search).has("mock")
