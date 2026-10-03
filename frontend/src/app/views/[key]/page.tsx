"use client";

import { useParams } from "next/navigation";
import ViewPage from "@/components/views/ViewPage";

/** A view you made (Settings → Views & dashboards). */
export default function CustomViewPage() {
  const { key } = useParams<{ key: string }>();
  return <ViewPage viewKey={key} />;
}
