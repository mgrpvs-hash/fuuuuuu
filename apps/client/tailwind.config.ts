import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        boardBg: "#07130E",
        boardSurface: "#123524",
        panel: "#122821",
        borderSoft: "#2A4A3D",
        gold: "#FBBF24",
        goldDark: "#D4A017",
        green: "#22C55E",
        danger: "#EF4444"
      },
      boxShadow: {
        premium: "0 18px 40px rgba(0,0,0,0.35)",
        token: "0 8px 16px rgba(0,0,0,0.45)"
      },
      borderRadius: {
        card: "16px"
      }
    }
  },
  plugins: []
} satisfies Config;
