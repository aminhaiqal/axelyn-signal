import type { AgentName } from "./agents";

/**
 * V1 working context. Keep claims conservative and edit this file as Axelyn's
 * positioning, proof, and exclusions become more specific.
 */
export const axelynContext = {
  company: "Axelyn Technologies helps teams translate real business needs into dependable software and practical AI-enabled systems.",
  positioning: "A technically credible delivery partner focused on judgment, clarity, and production outcomes—not technology theatre.",
  targetAudience: [
    "founders and business owners making technology decisions",
    "CTOs and technical leaders",
    "product and operations leaders responsible for delivery outcomes",
    "engineers adapting their practice to AI-assisted development",
  ],
  objectives: [
    "earn attention from relevant people",
    "build recognition and familiarity over time",
    "demonstrate credible judgment",
    "create useful business conversations",
  ],
  principles: [
    "practical, clear, technically credible, and experience-driven",
    "use simple language and respect counterarguments",
    "be useful before being promotional",
    "avoid corporate voice, hype, and universal claims",
    "kill ideas that 500 generic AI creators could publish unchanged",
  ],
  credibleExperience: [
    "translating business requirements into production software",
    "software architecture and engineering delivery tradeoffs",
    "AI-assisted software development and its practical limits",
    "connecting technical implementation choices to business outcomes",
  ],
  avoidExpertiseClaims: [
    "regulated legal, medical, or financial advice",
    "industry-specific results without direct project evidence",
    "proprietary performance benchmarks without measured data",
    "claims of guaranteed ROI, productivity, or business outcomes",
  ],
} as const;

export function contextFor(agent: AgentName) {
  switch (agent) {
    case "scout":
      return {
        company: axelynContext.company,
        targetAudience: axelynContext.targetAudience,
        credibleExperience: axelynContext.credibleExperience,
      };
    case "explorer":
      return {
        positioning: axelynContext.positioning,
        targetAudience: axelynContext.targetAudience,
        principles: axelynContext.principles,
        credibleExperience: axelynContext.credibleExperience,
      };
    case "critic":
      return {
        principles: axelynContext.principles,
        credibleExperience: axelynContext.credibleExperience,
        avoidExpertiseClaims: axelynContext.avoidExpertiseClaims,
      };
    case "strategist":
      return {
        positioning: axelynContext.positioning,
        objectives: axelynContext.objectives,
        targetAudience: axelynContext.targetAudience,
        credibleExperience: axelynContext.credibleExperience,
        avoidExpertiseClaims: axelynContext.avoidExpertiseClaims,
      };
  }
}
