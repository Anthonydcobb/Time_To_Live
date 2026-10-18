import { resolve } from "node:path";
import { defineConfig } from "vite";

// Two pages: the bench terminal (index.html) and the game (game.html).
export default defineConfig({
  base: "./",
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        bench: resolve(import.meta.dirname, "index.html"),
        game: resolve(import.meta.dirname, "game.html"),
      },
    },
  },
});
