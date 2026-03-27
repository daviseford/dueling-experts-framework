const params = new URLSearchParams(window.location.search)

export const isMock =
  import.meta.env.VITE_MOCK === "true" || params.has("mock")

/** Which mock scenario to use: "default" | "empty" | "loading" | "thinking" | "paused" */
export const mockScenario: string | null = isMock
  ? params.get("mock") || "default"
  : null
