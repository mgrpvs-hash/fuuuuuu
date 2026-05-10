import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bgDark: "#07130E",
        bg: "#0B1E16",
        panel: "#122821",
        border: "#1F3D33",
        gold: "#FBBF24",
        goldDeep: "#D4A017",
        green: "#22C55E",
        danger: "#EF4444"
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"]
      },
      borderRadius: {
        card: "12px"
      }
    }
  },
  plugins: []
} satisfies Config;
