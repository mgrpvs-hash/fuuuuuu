import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        appBg: "#07130E",
        panel: "#122821",
        board: "#0B2A1D",
        border: "#2A4A3D",
        gold: "#FBBF24",
        success: "#22C55E",
        danger: "#EF4444"
      }
    }
  },
  plugins: []
} satisfies Config;
