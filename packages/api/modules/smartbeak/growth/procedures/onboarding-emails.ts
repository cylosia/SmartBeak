import { sendEmail } from "@repo/mail";
import { z } from "zod";
import { protectedProcedure, adminProcedure } from "../../../../orpc/procedures";

const ONBOARDING_SEQUENCE = [
  {
    step: 1,
    subject: "Welcome to SmartBeak — let's get your first domain live",
    delayDays: 0,
    body: (name: string) => `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
        <h1 style="font-size: 22px; font-weight: 700; color: #0f172a;">Welcome${name ? `, ${name}` : ""}! 🎉</h1>
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">
          You've just unlocked the most powerful AI content publishing platform for domain portfolio owners.
          Here's your 3-step quick start:
        </p>
        <ol style="color: #475569; font-size: 15px; line-height: 2;">
          <li><strong>Add your first domain</strong> — go to Domains → Add Domain</li>
          <li><strong>Run the Diligence Engine</strong> — get your domain's sell-ready score instantly</li>
          <li><strong>Generate your first AI content idea</strong> — use the SEO Intelligence panel</li>
        </ol>
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://smartbeak.io"}/app"
           style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
          Open SmartBeak →
        </a>
      </div>
    `,
  },
  {
    step: 2,
    subject: "Your SmartBeak SEO Intelligence is ready to use",
    delayDays: 2,
    body: (name: string) => `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
        <h1 style="font-size: 22px; font-weight: 700; color: #0f172a;">Unlock your SEO potential${name ? `, ${name}` : ""}</h1>
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">
          SmartBeak's SEO Intelligence module helps you find high-value keywords, track decay signals,
          and generate AI-powered content ideas that actually rank.
        </p>
        <p style="color: #475569; font-size: 15px; line-height: 1.6;">
          <strong>Try it now:</strong> Navigate to any domain → SEO Intelligence → AI Ideas Generator.
          Enter your niche and get 5 structured content ideas with titles, outlines, and SEO scores in seconds.
        </p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://smartbeak.io"}/app"
           style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
          Generate Ideas →
        </a>
      </div>
    `,
  },
  {
    step: 3,
    subject: "Is your domain sell-ready? Check your score now",
    delayDays: 5,
    body: (name: string) => `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
        <h1 style="font-size: 22px; font-weight: 700; color: #0f172a;">Your Sell-Ready Score${name ? `, ${name}` : ""}</h1>
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">
          SmartBeak's Diligence Engine automatically checks ownership, legal, financial, and content signals
          to give you a composite Sell-Ready Score for each domain.
        </p>
        <p style="color: #475569; font-size: 15px; line-height: 1.6;">
          Domains with a score above 80 sell for <strong>2-4x more</strong> than unoptimized ones.
          See exactly what to fix to maximise your exit value.
        </p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://smartbeak.io"}/app"
           style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
          Check My Score →
        </a>
      </div>
    `,
  },
];

// ── trigger-onboarding-sequence (called on new user signup) ───────────────────
export const triggerOnboardingSequenceProcedure = protectedProcedure
  .input(
    z.object({
      email: z.string().email(),
      firstName: z.string().optional(),
    }),
  )
  .handler(async ({ input }) => {
    const { email, firstName = "" } = input;
    const results: { step: number; sent: boolean; error?: string }[] = [];

    // Step 1 is sent immediately; steps 2 and 3 are queued (in production,
    // use a job queue like Inngest or Trigger.dev — here we send step 1 only
    // and return the full sequence plan for the queue to handle).
    const step1 = ONBOARDING_SEQUENCE[0]!;
    try {
      await sendEmail({
        to: email,
        subject: step1.subject,
        html: step1.body(firstName),
        text: `Welcome to SmartBeak! Open the app at: ${process.env.NEXT_PUBLIC_APP_URL ?? "https://smartbeak.io"}/app`,
      });
      results.push({ step: 1, sent: true });
    } catch (err) {
      results.push({ step: 1, sent: false, error: String(err) });
    }

    return {
      results,
      sequencePlan: ONBOARDING_SEQUENCE.map((s) => ({
        step: s.step,
        subject: s.subject,
        delayDays: s.delayDays,
      })),
    };
  });

// ── send-onboarding-step (admin / cron trigger) ───────────────────────────────
export const sendOnboardingStepProcedure = adminProcedure
  .input(
    z.object({
      email: z.string().email(),
      firstName: z.string().optional(),
      step: z.number().int().min(1).max(3),
    }),
  )
  .handler(async ({ input }) => {
    const { email, firstName = "", step } = input;
    const seq = ONBOARDING_SEQUENCE.find((s) => s.step === step);
    if (!seq) throw new Error(`Onboarding step ${step} not found`);
    await sendEmail({
      to: email,
      subject: seq.subject,
      html: seq.body(firstName),
      text: `Open SmartBeak: ${process.env.NEXT_PUBLIC_APP_URL ?? "https://smartbeak.io"}/app`,
    });
    return { sent: true, step };
  });
