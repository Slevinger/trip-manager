/**
 * Declarative shell metadata for the unified step creation wizard.
 * Flow logic lives in StepFlowWizard; this file is the single source for i18n keys and step counts.
 */

export type StepWizardEntry = "full" | "hotels_only" | "transports_only";

export const STAY_WIZARD_TOTAL_STEPS = 5;

export const STAY_WIZARD_SHELL = [
  {
    titleKey: "stepWizard.stayBasicsTitle",
    descKey: "stepWizard.stayBasicsHint",
  },
  {
    titleKey: "stepWizard.stayWhenTitle",
    descKey: "stepWizard.stayWhenHint",
  },
  {
    titleKey: "stepWizard.stayHotelTitle",
    descKey: "stepWizard.stayHotelHint",
  },
  {
    titleKey: "stepWizard.afterListItemTitle",
    descKey: "stepWizard.stayAfterHotelBody",
  },
  {
    titleKey: "stepWizard.reviewTitle",
    descKey: "stepWizard.reviewHintStay",
  },
] as const;

export const TRANSIT_WIZARD_TOTAL_STEPS = 5;

export const TRANSIT_WIZARD_SHELL = [
  {
    titleKey: "stepWizard.transitBasicsTitle",
    descKey: "stepWizard.transitBasicsHint",
  },
  {
    titleKey: "stepWizard.transitWhenTitle",
    descKey: "stepWizard.transitWhenHint",
  },
  {
    titleKey: "stepWizard.transitTransportTitle",
    descKey: "stepWizard.transitTransportHint",
  },
  {
    titleKey: "stepWizard.afterListItemTitle",
    descKey: "stepWizard.transitAfterTransportBody",
  },
  {
    titleKey: "stepWizard.reviewTitle",
    descKey: "stepWizard.reviewHintTransit",
  },
] as const;
