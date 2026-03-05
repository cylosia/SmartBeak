"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  endOfWeek,
  subMonths,
} from "date-fns";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Button } from "@repo/ui/components/button";
import { ChevronLeftIcon, ChevronRightIcon, ActivityIcon, GlobeIcon, MailIcon, LinkedinIcon } from "lucide-react";
import { ErrorBoundary } from "@/modules/smartbeak/shared/components/ErrorBoundary";

const PLATFORM_COLORS: Record<string, string> = {
  web: "bg-blue-500",
  email: "bg-purple-500",
  linkedin: "bg-sky-600",
  facebook: "bg-indigo-500",
  instagram: "bg-pink-500",
  youtube: "bg-red-500",
  tiktok: "bg-gray-900 dark:bg-gray-100",
  pinterest: "bg-red-600",
  vimeo: "bg-cyan-500",
  soundcloud: "bg-orange-500",
  wordpress: "bg-blue-700",
};

export function PublishingCalendar({
  organizationSlug,
  domainId,
}: {
  organizationSlug: string;
  domainId: string;
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const from = startOfWeek(startOfMonth(currentMonth));
  const to = endOfWeek(endOfMonth(currentMonth));

  const calendarQuery = useQuery(
    orpc.smartbeak.publishingSuite.calendar.queryOptions({
      input: {
        organizationSlug,
        domainId,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    }),
  );

  const byDate = calendarQuery.data?.byDate ?? {};
  const days = eachDayOfInterval({ start: from, end: to });

  return (
    <ErrorBoundary>
      <div className="rounded-xl border border-border bg-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold">{format(currentMonth, "MMMM yyyy")}</h3>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setCurrentMonth(new Date())}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const key = format(day, "yyyy-MM-dd");
            const jobs = byDate[key] ?? [];
            const isCurrentMonth = isSameMonth(day, currentMonth);
            const isToday = isSameDay(day, new Date());

            return (
              <div
                key={key}
                className={`min-h-[80px] border-b border-r border-border p-1.5 ${
                  !isCurrentMonth ? "bg-muted/30" : ""
                } ${i % 7 === 6 ? "border-r-0" : ""}`}
              >
                <div
                  className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    isToday
                      ? "bg-primary text-primary-foreground"
                      : isCurrentMonth
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {format(day, "d")}
                </div>
                <div className="space-y-0.5">
                  {jobs.slice(0, 3).map((job: any) => (
                    <div
                      key={job.id}
                      className={`truncate rounded px-1 py-0.5 text-[10px] font-medium text-white ${
                        PLATFORM_COLORS[job.target] ?? "bg-gray-500"
                      }`}
                      title={`${job.target} — ${job.status}`}
                    >
                      {job.target}
                    </div>
                  ))}
                  {jobs.length > 3 && (
                    <div className="text-[10px] text-muted-foreground">
                      +{jobs.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
          {Object.entries(PLATFORM_COLORS).map(([platform, color]) => (
            <div key={platform} className="flex items-center gap-1 text-xs text-muted-foreground">
              <div className={`h-2 w-2 rounded-full ${color}`} />
              <span className="capitalize">{platform}</span>
            </div>
          ))}
        </div>
      </div>
    </ErrorBoundary>
  );
}
