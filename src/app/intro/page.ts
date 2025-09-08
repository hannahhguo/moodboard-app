"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

export default function IntroPage() {
  const router = useRouter();

  function start() {
    // remember they've seen the intro for 1 year
    document.cookie = `intro=1; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.push("/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center p-8 text-center">
      <motion.h1
        className="text-4xl font-semibold"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        AI Mood Board for Songwriters
      </motion.h1>

      <motion.p
        className="mt-4 max-w-2xl text-balance text-gray-600"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
      >
        Describe a feeling or lyric, then curate images that match your vibe.
        We learn from what you keep to refine future suggestions.
      </motion.p>

      <motion.div
        className="mt-8 flex gap-3"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
      >
        <button
          onClick={start}
          className="rounded-xl bg-black px-6 py-3 text-white hover:opacity-90"
        >
          Start
        </button>
        <a
          href="https://openverse.org/"
          target="_blank"
          className="rounded-xl border px-6 py-3 text-sm hover:bg-gray-50"
        >
          About the image source
        </a>
      </motion.div>

      <p className="mt-6 text-xs text-gray-500">
        Tip: You can drag images on the board to rearrange them.
      </p>
    </main>
  );
}
