"use client";

import { TagIcon } from "@phosphor-icons/react";
import { useCatalog } from "@/lib/catalog";
import { CARD } from "@/lib/ui";
import CategoriesManager from "@/components/planning/CategoriesManager";
import SectionHeader from "@/components/settings/SectionHeader";

export default function Page() {
  const { categories } = useCatalog();
  const active = categories.filter((c) => !c.archived).length;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={TagIcon}
        title="Categories"
        summary={`${active} ${active === 1 ? "category" : "categories"}: life areas for tasks and events, each with a color and style.`}
      />
      <div className={`p-3 ${CARD}`}>
        <CategoriesManager />
      </div>
    </div>
  );
}
