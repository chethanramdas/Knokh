import { useMutation } from "convex/react";
import { Loader2, Mail, MessageSquare, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import {
  Container,
  EmptyState,
  InfoNote,
  SectionHeading,
} from "@/components/knokh/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePageMeta } from "@/lib/seo";
import { useStore } from "@/lib/store";

type Section = { heading: string; body: string[]; list?: string[] };

/**
 * Policy pages. These are written to be true for how this application actually
 * behaves. Anything that depends on the real business (legal entity, address,
 * tax registration, supplier agreements) is left as an explicit action item for
 * the store owner instead of being invented.
 */
const PAGES: Record<
  string,
  { title: string; summary: string; sections: Section[]; needsOwnerInput?: boolean }
> = {
  about: {
    title: "About KNOKH",
    summary: "A multi-category marketplace built for clear pricing and honest stock data.",
    sections: [
      {
        heading: "What we are",
        body: [
          "KNOKH is a multi-category marketplace. Your World. One Marketplace.",
          "We bring electronics, fashion, home, beauty, fitness, toys, travel, office and automotive products into a single storefront with consistent pricing, delivery expectations and returns information.",
        ],
      },
      {
        heading: "How we work",
        body: [
          "Products are held in our own catalog database. Availability, pricing and delivery estimates you see come from that catalog, not from estimated or sample figures.",
          "We do not publish invented ratings, reviews or sales counts. A rating only appears when real customer reviews have been approved, and best-seller lists are ranked from real completed orders.",
        ],
      },
      {
        heading: "Business details",
        body: [
          "The registered business name, address and tax identifiers are configured by the store owner in the admin settings and are shown on invoices. They are deliberately not filled in with placeholder text here.",
        ],
      },
    ],
    needsOwnerInput: true,
  },
  help: {
    title: "Help centre",
    summary: "Answers to the most common questions about orders, delivery and returns.",
    sections: [
      {
        heading: "Start here",
        body: ["Pick the topic closest to your question:"],
        list: [
          "Order status and tracking — see Track an order, or My orders when signed in.",
          "Payments and invoices — see Payment information and Invoice & tax.",
          "Delivery times and charges — see the shipping policy.",
          "Returns, refunds and cancellations — see the linked policies below.",
          "Product availability and stock — stock is live from our catalog; if an item sells out, checkout will stop you before you pay.",
        ],
      },
      {
        heading: "Still stuck?",
        body: [
          "Use the contact form and include your order number if you have one. We reply to the email address you provide.",
        ],
      },
    ],
  },
  faq: {
    title: "Frequently asked questions",
    summary: "Direct answers about ordering, payments, delivery and returns on KNOKH.",
    sections: [
      {
        heading: "Ordering",
        body: ["How do I place an order?"],
        list: [
          "Add items to the cart, open checkout, confirm the delivery address and choose a payment method.",
          "Totals including shipping and tax are recalculated on our server before the order is created, so the amount charged always matches the order record.",
        ],
      },
      {
        heading: "Payments",
        body: ["Which payment methods are available?"],
        list: [
          "Online payment methods are listed at checkout as soon as a payment provider is configured and approved for your destination country and currency.",
          "Cash on delivery is offered where the destination zone allows it.",
          "We never store card numbers or CVV values — they are handled entirely by the payment provider.",
        ],
      },
      {
        heading: "Delivery",
        body: ["How long does delivery take?"],
        list: [
          "Each product shows a dispatch estimate, and checkout adds the transit time for your destination country.",
          "Cross-border orders can be subject to import duties or taxes charged by your local customs authority. These are not prepaid unless explicitly stated at checkout.",
        ],
      },
      {
        heading: "Returns",
        body: ["Can I return an item?"],
        list: [
          "Yes — within the return window in the returns policy, provided the item is unused and in its original packaging.",
          "Raise the request from the order page. Refunds are processed after the returned item is received and inspected.",
        ],
      },
    ],
  },
  contact: {
    title: "Contact us",
    summary: "Send us a message and we will reply by email.",
    sections: [
      {
        heading: "How to reach us",
        body: [
          "Use the form below, or look up your order first if your question is about an existing purchase — it is usually the fastest route.",
        ],
      },
    ],
  },
  "shipping-policy": {
    title: "Shipping policy",
    summary: "Where we ship, how long it takes and what it costs.",
    sections: [
      {
        heading: "Destinations",
        body: [
          "Serviceable countries and their delivery windows are configured in Admin → Settings → Shipping zones. Countries marked as not serviceable cannot be selected at checkout.",
          "Some products are restricted to specific destinations by the supplier or by law. The product page lists the destinations a product can ship to.",
        ],
      },
      {
        heading: "Charges and free delivery",
        body: [
          "Shipping rates are set per destination zone. Where free delivery is offered above a threshold, the threshold is applied to the item subtotal and is shown in your cart.",
          "Duties and import taxes for cross-border orders may be charged by your local customs authority on delivery. We do not claim prepaid duties unless the checkout explicitly says so.",
        ],
      },
      {
        heading: "Dispatch and tracking",
        body: [
          "Dispatch estimates are shown on each product. Tracking numbers are added to your order as soon as the fulfilment partner provides them; not every partner supplies tracking for every destination.",
        ],
      },
    ],
  },
  "returns-refunds": {
    title: "Returns and refunds",
    summary: "How to return an item and how refunds are processed.",
    sections: [
      {
        heading: "Return window",
        body: [
          "Return requests can be raised from the order page once your parcel has been shipped. The window and any category exclusions must be configured by the store owner to match their supplier agreements.",
        ],
      },
      {
        heading: "Condition",
        body: [
          "Items must be unused and returned in their original packaging with all accessories. Hygiene products, personal care items and customised goods may be excluded where local consumer law allows.",
        ],
      },
      {
        heading: "Refund processing",
        body: [
          "Every refund request is reviewed by a person. Once approved, the refund is issued through the original payment provider where the gateway supports it, and the refund record is stored against the order.",
          "The time for the money to appear depends on the provider and your bank; we publish the provider's typical timeline once a gateway is configured.",
        ],
      },
    ],
    needsOwnerInput: true,
  },
  "cancellation-policy": {
    title: "Cancellation policy",
    summary: "When an order can be cancelled and what happens if it is already paid.",
    sections: [
      {
        heading: "Before dispatch",
        body: [
          "You can cancel an order from your order page while it is awaiting confirmation, being prepared or forwarded to a supplier. Reserved stock is released as soon as the cancellation is recorded.",
        ],
      },
      {
        heading: "After dispatch",
        body: [
          "Once an order is shipped it can no longer be cancelled. Raise a return request instead.",
        ],
      },
      {
        heading: "Paid orders",
        body: [
          "If a paid order is cancelled, a refund request is created automatically and must be approved before the provider is instructed to refund it.",
        ],
      },
    ],
  },
  "privacy-policy": {
    title: "Privacy policy",
    summary: "What data we collect, why, and how you can have it removed.",
    sections: [
      {
        heading: "Data we collect",
        body: ["We collect only what is needed to sell and deliver a product:"],
        list: [
          "Account data: email address, name, phone number and password-free sign-in codes.",
          "Order data: items, prices, delivery address, order status and support messages.",
          "Technical data: aggregated, non-identifying analytics events (page views, product views, searches) with no IP address and no third-party advertising identifiers.",
        ],
      },
      {
        heading: "What we never store",
        body: [
          "Card numbers, CVV codes and full payment credentials are never stored on KNOKH servers. Payments are handled by the payment provider, and we record only the provider's reference identifiers, amounts and signature-verification results.",
          "Supplier and payment secrets live only in server-side environment variables and are never sent to the browser.",
        ],
      },
      {
        heading: "Your rights",
        body: [
          "You can update your profile and addresses at any time, and request deletion of your account and personal data from the profile page. Orders are retained for the period required for tax and consumer-protection records before deletion.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms and conditions",
    summary: "The rules that apply when you buy from KNOKH.",
    sections: [
      {
        heading: "Using the store",
        body: [
          "You agree to provide accurate contact and delivery details, and not to misuse the store, attempt to interfere with its security, or place fraudulent orders.",
        ],
      },
      {
        heading: "Orders and pricing",
        body: [
          "An order is an offer to buy. We confirm it when payment is verified (or when a cash-on-delivery order is accepted) and dispatch is arranged.",
          "Prices and availability are validated on our server at the moment you order. If an obvious pricing error occurs, we will contact you before charging or dispatching.",
        ],
      },
      {
        heading: "Liability",
        body: [
          "Nothing in these terms limits rights you have under applicable consumer law. The store owner must complete jurisdiction-specific clauses, including governing law, before trading.",
        ],
      },
    ],
    needsOwnerInput: true,
  },
  "cookie-policy": {
    title: "Cookie policy",
    summary: "How browser storage is used on this store.",
    sections: [
      {
        heading: "Essential storage",
        body: ["We use browser storage that is required for the store to work:"],
        list: [
          "A session key so a guest cart can be held before you sign in.",
          "Your selected display currency and destination country.",
          "Your sign-in session cookie.",
        ],
      },
      {
        heading: "Analytics",
        body: [
          "If an analytics ID is configured by the store owner, analytics may be loaded. Our own analytics events contain no IP address and no personal identifiers. Advertising or cross-site tracking cookies are not used by default.",
        ],
      },
    ],
  },
  warranty: {
    title: "Warranty information",
    summary: "Manufacturer warranty, what is covered and how to claim.",
    sections: [
      {
        heading: "Manufacturer warranty",
        body: [
          "Where a manufacturer offers a warranty, the warranty terms and period are set by the manufacturer and supplied with the product. Warranty claims in India are handled under the Consumer Protection Act, 2019 and the manufacturer's own terms.",
        ],
      },
      {
        heading: "What is not covered",
        body: [
          "Physical damage, liquid damage, unauthorised repairs, normal wear and tear, and consumable parts are typically excluded. Always check the documentation supplied with the product.",
        ],
      },
      {
        heading: "Raising a claim",
        body: [
          "Contact support with your order number, a description of the fault and photographs where relevant. We will coordinate with the supplier or brand service centre where the arrangement allows.",
        ],
      },
    ],
  },
  "payment-information": {
    title: "Payment information",
    summary: "Payment methods, security and what appears on your statement.",
    sections: [
      {
        heading: "Methods",
        body: [
          "Supported methods depend on the payment providers enabled for your destination country and currency. Available options are listed at checkout, and any provider that is not yet configured is clearly shown as unavailable rather than failing silently.",
        ],
      },
      {
        heading: "Security",
        body: ["Payment security is enforced on the server:"],
        list: [
          "The payable amount is always recalculated on our server — the browser cannot change a price or total.",
          "Webhook signatures are verified with the provider's documented algorithm before an order is marked paid.",
          "Duplicate gateway events are detected and ignored, so a repeated webhook cannot fulfil an order twice.",
          "A success redirect alone never marks an order as paid.",
        ],
      },
      {
        heading: "Cash on delivery",
        body: [
          "Where COD is available for your destination, you pay the courier on delivery. Please have the exact amount ready; the courier may not carry change.",
        ],
      },
    ],
  },
  "international-shipping": {
    title: "International shipping",
    summary: "Cross-border delivery, duties and currency.",
    sections: [
      {
        heading: "Eligibility",
        body: [
          "We only enable international checkout for destinations where a payment provider and a shipping route are both available. If a destination is not serviceable it is marked as such in the country selector and cannot be chosen at checkout.",
        ],
      },
      {
        heading: "Duties and taxes",
        body: [
          "For most cross-border orders, import duties and taxes are assessed by your country's customs authority and are payable by the recipient. We do not promise prepaid duties unless the checkout explicitly states that duties are included.",
        ],
      },
      {
        heading: "Currencies",
        body: [
          "You can browse and pay in the currencies enabled by the store owner. Display prices are converted using the store's configured rates; the order total is fixed in the checkout currency at the time the order is placed.",
        ],
      },
    ],
  },
  "invoice-and-tax": {
    title: "Invoice and tax information",
    summary: "Where invoices are issued from and what tax identifiers are required.",
    sections: [
      {
        heading: "Invoices",
        body: [
          "An invoice reference is generated for every order. The legal entity name, registered address and tax registration numbers printed on invoices come from the store owner's settings — they must be completed before trading.",
        ],
      },
      {
        heading: "Tax on your order",
        body: [
          "Tax treatment depends on the destination country rules configured in Admin → Settings → Tax rules. Where prices are tax-inclusive, the tax portion is shown separately in the cart and at checkout.",
        ],
      },
    ],
    needsOwnerInput: true,
  },
  accessibility: {
    title: "Accessibility statement",
    summary: "Our accessibility commitments and how to report a barrier.",
    sections: [
      {
        heading: "What we do",
        body: ["The storefront is built to work for as many people as possible:"],
        list: [
          "Semantic headings, labelled form controls and descriptive button names.",
          "Keyboard-operable navigation, dialogs, filters and quantity controls.",
          "Visible focus outlines and text contrast checked against the WCAG 2.1 AA contrast minimum.",
          "Responsive layouts that work from small Android phones up to desktop, with touch targets sized for fingers.",
        ],
      },
      {
        heading: "Known limitations",
        body: [
          "Product imagery supplied by third parties may not always have a detailed description. If a product image is unclear, contact us and we will describe it.",
        ],
      },
      {
        heading: "Reporting a barrier",
        body: [
          "Tell us what you were trying to do and the device or assistive technology you used. We treat accessibility reports as priority support requests.",
        ],
      },
    ],
  },
};

function ContactForm() {
  const submit = useMutation(api.account.createSupportTicket);
  const [mountedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState("Order enquiry");
  const honeypot = useRef<HTMLInputElement>(null);

  return (
    <form
      className="space-y-4 rounded-xl border border-border bg-card p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const data = new FormData(event.currentTarget);
        try {
          await submit({
            name: String(data.get("name") ?? ""),
            email: String(data.get("email") ?? ""),
            subject: String(data.get("subject") ?? ""),
            message: String(data.get("message") ?? ""),
            topic,
            orderNumber: String(data.get("orderNumber") ?? "") || undefined,
            elapsedMs: Date.now() - mountedAt,
            honeypot: honeypot.current?.value ?? "",
          });
          toast.success("Message sent. We reply to the email address you provided.");
          event.currentTarget.reset();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not send your message.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="size-4" /> Send us a message
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="c-name">Your name</Label>
          <Input id="c-name" name="name" required />
        </div>
        <div>
          <Label htmlFor="c-email">Email</Label>
          <Input id="c-email" name="email" type="email" required />
        </div>
        <div>
          <Label htmlFor="c-topic">Topic</Label>
          <select
            id="c-topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
          >
            {[
              "Order enquiry",
              "Delivery or tracking",
              "Payment or invoice",
              "Return or refund",
              "Product question",
              "Wholesale or partnership",
              "Accessibility",
              "Privacy request",
            ].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="c-order">Order number (optional)</Label>
          <Input id="c-order" name="orderNumber" placeholder="KN-260101-000123" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="c-subject">Subject</Label>
          <Input id="c-subject" name="subject" required />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="c-message">How can we help?</Label>
          <Textarea id="c-message" name="message" rows={5} required />
        </div>
      </div>
      {/* Bot trap: hidden from people, irresistible to simple spam scripts. */}
      <input
        ref={honeypot}
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <Button type="submit" disabled={busy} className="gap-2">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Send message
      </Button>
      <p className="text-xs text-muted-foreground">
        We use your details only to answer this enquiry. See the privacy policy for retention
        details.
      </p>
    </form>
  );
}

export default function Info() {
  const { slug = "" } = useParams();
  const { config, contact } = useStore();
  const page = PAGES[slug];

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [slug]);

  usePageMeta({
    title: page?.title ?? "Information",
    description: page?.summary,
    path: `/info/${slug}`,
    siteUrl: config?.seo.siteUrl,
    noIndex: !page,
  });

  if (!page) {
    return (
      <Container className="py-16">
        <EmptyState
          title="Page not found"
          description="That information page does not exist."
          action={
            <Button asChild>
              <Link to="/info/help">Go to the help centre</Link>
            </Button>
          }
        />
      </Container>
    );
  }

  return (
    <Container className="max-w-4xl py-10">
      <SectionHeading title={page.title} subtitle={page.summary} />

      {page.needsOwnerInput ? (
        <InfoNote tone="warning" className="mt-5">
          <strong>Store owner action required.</strong> This page intentionally leaves legal
          entity, registration, address and jurisdiction-specific wording blank. Complete them in
          Admin → Settings before trading.
        </InfoNote>
      ) : null}

      <div className="mt-8 space-y-8">
        {page.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-lg font-bold tracking-tight">{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
            {section.list ? (
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                {section.list.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>

      {slug === "contact" ? (
        <div className="mt-8 space-y-5">
          {contact.supportEmail ? (
            <p className="flex items-center gap-2 text-sm">
              <Mail className="size-4 text-primary" />
              <a href={`mailto:${contact.supportEmail}`} className="hover:underline">
                {contact.supportEmail}
              </a>
            </p>
          ) : (
            <InfoNote>
              A support email address has not been configured yet. Add one in Admin → Settings so
              customers can be reached outside the contact form.
            </InfoNote>
          )}
          <ContactForm />
        </div>
      ) : null}

      <div className="mt-10 flex flex-wrap gap-2 border-t border-border pt-6 text-sm">
        <Button asChild variant="outline">
          <Link to="/info/help">Help centre</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/info/faq">FAQ</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/info/contact">Contact us</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/track-order">Track an order</Link>
        </Button>
      </div>
    </Container>
  );
}
