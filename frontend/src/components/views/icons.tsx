// View icons: the fixed set the server accepts (app.services.views.ICONS).
import { createElement } from "react";
import {
  BookOpenIcon,
  BriefcaseIcon,
  CalendarDotsIcon,
  CodeIcon,
  CoffeeIcon,
  FlagIcon,
  GraduationCapIcon,
  HeartIcon,
  ListChecksIcon,
  RocketLaunchIcon,
  SquaresFourIcon,
  StarIcon,
  SunIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react";

export const VIEW_ICONS: Record<string, Icon> = {
  squares: SquaresFourIcon,
  sun: SunIcon,
  "graduation-cap": GraduationCapIcon,
  briefcase: BriefcaseIcon,
  code: CodeIcon,
  calendar: CalendarDotsIcon,
  heart: HeartIcon,
  star: StarIcon,
  list: ListChecksIcon,
  book: BookOpenIcon,
  rocket: RocketLaunchIcon,
  coffee: CoffeeIcon,
  users: UsersThreeIcon,
  flag: FlagIcon,
};

export function viewIcon(name: string): Icon {
  return VIEW_ICONS[name] ?? SquaresFourIcon;
}

/** A view's icon as an element (picked by name, rendered by a stable
 * component). */
export function ViewIconGlyph({ name, className, weight }: { name: string; className?: string; weight?: "regular" | "fill" }) {
  return createElement(viewIcon(name), { className, weight, "aria-hidden": true });
}
