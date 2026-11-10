"use client";

import Image from "next/image";
import Link from "next/link";
import { ArcProvider } from "@/components/arc/lib/arc-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ArcProvider link={Link} image={Image}>
      {children}
    </ArcProvider>
  );
}
