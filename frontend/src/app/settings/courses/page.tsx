"use client";

import { GraduationCapIcon } from "@phosphor-icons/react";
import { useCatalog } from "@/lib/catalog";
import { CARD } from "@/lib/ui";
import CoursesManager from "@/components/planning/CoursesManager";
import SectionHeader from "@/components/settings/SectionHeader";

export default function Page() {
  const { courses } = useCatalog();
  const active = courses.filter((c) => !c.archived).length;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={GraduationCapIcon}
        title="Courses"
        summary={`${active} ${active === 1 ? "course" : "courses"}. Canvas assignments link to theirs automatically; fix a wrong one from the item and Look remembers.`}
      />
      <div className={`p-3 ${CARD}`}>
        <CoursesManager />
      </div>
    </div>
  );
}
