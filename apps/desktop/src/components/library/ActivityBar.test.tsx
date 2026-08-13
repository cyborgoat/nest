import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActivityBar } from "./ActivityBar";

describe("ActivityBar account navigation", () => {
  it("places Account above Settings", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <TooltipProvider>
          <ActivityBar
            hasSourceControlChanges={false}
            hasPacksUnderReview={false}
            hasPackUpdates={false}
          />
        </TooltipProvider>
      </I18nProvider>,
    );

    const accountIndex = html.indexOf('aria-label="Account"');
    const settingsIndex = html.indexOf('aria-label="Settings"');

    expect(accountIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeGreaterThan(accountIndex);
  });
});
