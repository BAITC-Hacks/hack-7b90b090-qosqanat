import { randomUUID } from "node:crypto";
import { AppError, type CaseState, type Slots } from "@voice/contracts";
import { kb, AS_OF, lookup } from "@voice/knowledge";
import { Store } from "@voice/db";
const number = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new AppError("invalid_input");
  return n;
};
export function ogpoPrice(s: Slots, clients: any[]) {
  const p = kb.products.ogpo.pricing;
  const classes = ((s.drivers_iin as string[]) || []).map((i) =>
    String(clients.find((c) => c.iin === i)?.bm_class ?? "3"),
  );
  if (!classes.length) throw new AppError("invalid_input");
  const base = p.base_by_region_kzt[String(s.region)],
    vehicle = p.vehicle_type_coef[String(s.vehicle_type)];
  if (!base || !vehicle) throw new AppError("invalid_input");
  return Math.round(
    base * vehicle * Math.max(...classes.map((x) => p.bm_coef[x])),
  );
}
export function cascoPrice(s: Slots) {
  const p = kb.products.casco.pricing;
  const age = 2026 - number(s.car_year);
  const pack = String(s.package || "Standard");
  if (age < 0 || age > p.max_car_age[pack]) throw new AppError("not_eligible");
  const rate = age <= 3 ? 0.04 : age <= 7 ? 0.05 : age <= 10 ? 0.065 : null;
  if (rate === null) throw new AppError("tariff_unavailable");
  const f = p.franchise_coef[String(s.franchise ?? 0)];
  if (f === undefined) throw new AppError("invalid_input");
  return Math.round(number(s.car_value) * rate * f * p.package_coef[pack]);
}
const countryZone = (v: string) => {
  const x = v.toLowerCase();
  if (/usa|united states|canada|сша|канада|ақш/.test(x)) return "D";
  if (
    /georgia|грузи|грузия|russia|росси|ресей|uzbek|өзбек|узбек|kyrgyz|киргиз|қырғыз|armenia|армени|azerbaijan|азербайджан|belarus|беларус|tajik|таджик|тәжік/.test(
      x,
    )
  )
    return "A";
  if (
    /schengen|шенген|europe|европ|еуроп|germany|герман|france|франц|italy|итал|spain|испани|uk\b|britain|британ|ұлыбрит|poland|польш|greece|грец|netherland|нидерланд/.test(
      x,
    )
  )
    return "B";
  if (
    /turkey|түркия|турци|uae|эмират|әмірлік|dubai|дубай|thailand|таиланд|egypt|егип|мысыр|china|китай|қытай|japan|япон/.test(
      x,
    )
  )
    return "C";
  throw new AppError("country_unavailable");
};
export function travelPrice(s: Slots) {
  const zone = countryZone(String(s.trip_country));
  const start = Date.parse(String(s.trip_start)),
    end = Date.parse(String(s.trip_end));
  const days = Math.round((end - start) / 86400000) + 1;
  if (
    !Number.isFinite(days) ||
    days < 1 ||
    days > 366 ||
    String(s.trip_start) < AS_OF
  )
    throw new AppError("invalid_input");
  const age = number(s.traveler_max_age);
  if (age > 75) throw new AppError("not_eligible");
  const count = number(s.travelers_count);
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new AppError("invalid_input");
  const z = kb.products.travel.zones[zone];
  return {
    price: z.rate_per_day_kzt * days * count * (age >= 65 ? 2 : 1),
    zone,
    coverage: z.coverage,
  };
}
export function refund(policy: any, claims: any[]) {
  if (
    claims.some(
      (c) => c.policy_number === policy.policy_number && c.status === "paid",
    )
  )
    throw new AppError("not_eligible");
  const end = new Date(policy.end_date + "T00:00:00Z");
  const now = new Date(AS_OF + "T00:00:00Z");
  if (end < now) throw new AppError("policy_inactive");
  const exclusive = new Date(end.getTime() + 86400000);
  let months =
    (exclusive.getUTCFullYear() - now.getUTCFullYear()) * 12 +
    exclusive.getUTCMonth() -
    now.getUTCMonth();
  if (exclusive.getUTCDate() < now.getUTCDate()) months--;
  return Math.round(
    ((number(policy.premium) * Math.max(0, months)) / 12) * 0.9,
  );
}
export function activePolicy(policy: any) {
  if (
    policy.status === "cancelled" ||
    policy.end_date < AS_OF ||
    policy.start_date > AS_OF ||
    policy.status === "pending_payment"
  )
    throw new AppError("policy_inactive");
}
export function policyFor(
  store: Store,
  c: CaseState,
  s: Slots,
  allowCulprit = false,
) {
  let list = store.entities("policies", c.workspace_id);
  if (s.policy_number)
    list = list.filter((p) => p.policy_number === s.policy_number);
  else if (s.vehicle_plate || s.culprit_vehicle_plate)
    list = list.filter(
      (p) =>
        p.details?.vehicle_plate ===
        (s.culprit_vehicle_plate || s.vehicle_plate),
    );
  else list = list.filter((p) => p.client_id === c.client_id);
  if (s.product_type) list = list.filter((p) => p.product === s.product_type);
  if (!allowCulprit) list = list.filter((p) => p.client_id === c.client_id);
  if (!list.length) throw new AppError("not_found");
  if (list.length > 1) throw new AppError("ambiguous_policy");
  return list[0];
}
export function claimFor(store: Store, c: CaseState, s: Slots) {
  let list = store
    .entities("claims", c.workspace_id)
    .filter((x) => x.client_id === c.client_id);
  if (s.claim_number)
    list = list.filter((x) => x.claim_number === s.claim_number);
  if (!list.length) throw new AppError("not_found");
  if (list.length > 1) throw new AppError("ambiguous_claim");
  return list[0];
}
export function coverage(policy: any, service: string) {
  activePolicy(policy);
  if (policy.product !== "dms") throw new AppError("not_covered");
  const p = kb.products.dms.packages[policy.details.package];
  const v = service.toLowerCase();
  let category = "";
  if (/протез|имплант|prosthe|implant/.test(v))
    category = "Dental prosthetics and implants";
  else if (/космет|cosmet/.test(v)) category = "Cosmetology";
  else if (/лекар|дәрі|medication/.test(v)) category = "Outpatient medications";
  else if (/мрт|кт\b|mri|ct\b/.test(v)) category = "MRI and CT";
  else if (/стомат|тіс|зуб|denti/.test(v)) category = "Dentistry";
  else if (/узи|удз|ultrasound/.test(v)) category = "Ultrasound";
  else if (/анализ|талдау|lab|test/.test(v)) category = "Lab tests";
  else if (/терапевт|therapist/.test(v)) category = "Therapist visits";
  else if (/лор|кардио|гинек|ent|cardio|gyneco|pediatr|педиатр/.test(v))
    category = "Specialists";
  else throw new AppError("coverage_unclear");
  const excludes = p.not_covered.find((x: string) =>
    x.toLowerCase().startsWith(category.toLowerCase()),
  );
  const included = p.covered.find(
    (x: string) =>
      x.toLowerCase().startsWith(category.toLowerCase()) ||
      (category === "Dentistry" && x.startsWith("Dental treatment")) ||
      (category === "Lab tests" && x.startsWith("Basic lab")),
  );
  return {
    covered: !!included && !excludes,
    note:
      excludes || included || "Coverage not specified in the supplied package",
    package: policy.details.package,
  };
}
const newId = (prefix: string) =>
  prefix + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
export function runAction(
  store: Store,
  c: CaseState,
  name: string,
  s: Slots,
  execute = false,
): Record<string, unknown> {
  const w = c.workspace_id;
  const client = () => {
    const x = store
      .entities("clients", w)
      .find((x) => x.client_id === c.client_id);
    if (!x) throw new AppError("identification_required");
    return x;
  };
  const policy = () => policyFor(store, c, s, c.active === "SC12");
  const claim = () => claimFor(store, c, s);
  switch (name) {
    case "find_client":
      return { client_id: client().client_id, full_name: client().full_name };
    case "get_policies":
      return {
        policies: store
          .entities("policies", w)
          .filter((x) => x.client_id === c.client_id),
      };
    case "get_policy": {
      const p = policy();
      return {
        ...p,
        status:
          p.status ||
          (p.start_date > AS_OF
            ? "not_started"
            : p.end_date < AS_OF
              ? "expired"
              : "active"),
      };
    }
    case "get_claim":
      return claim();
    case "get_bm_class":
      return {
        bm_class:
          store
            .entities("clients", w)
            .find((x) => x.iin === s.iin || x.iin === s.new_driver_iin)
            ?.bm_class || "3",
      };
    case "calc_ogpo_price":
      return { price: ogpoPrice(s, store.entities("clients", w)) };
    case "calc_casco_price":
      return { price: cascoPrice(s) };
    case "calc_travel_price":
      return travelPrice(s);
    case "calc_property_price": {
      const price =
        kb.products.property.price_per_year_kzt[String(s.sum_insured)];
      if (!price) throw new AppError("not_eligible");
      return { price: price * (s.property_type === "house" ? 1.5 : 1) };
    }
    case "calc_accident_price": {
      const price =
        kb.products.accident.price_per_year_kzt[String(s.sum_insured)];
      if (!price) throw new AppError("not_eligible");
      return { price };
    }
    case "create_policy": {
      const product = String(s.product_type);
      const quote =
        product === "ogpo"
          ? { price: ogpoPrice(s, store.entities("clients", w)) }
          : product === "travel"
            ? travelPrice(s)
            : null;
      if (!quote) throw new AppError("not_eligible");
      if (!s.phone) throw new AppError("phone_required");
      const result: any = {
        ...quote,
        product,
        phone: s.phone,
        status: "pending_payment",
        details: s,
      };
      if (execute) {
        if (!c.client_id) {
          const existing = store
            .entities("clients", w)
            .find((x) => x.phone === s.phone);
          c.client_id = existing?.client_id || newId("C-");
          if (!existing)
            store.put(
              "clients",
              c.client_id!,
              {
                client_id: c.client_id,
                phone: s.phone,
                full_name: "Demo client",
              },
              w,
            );
        }
        const prefix = product === "ogpo" ? "OGPO" : "TRVL";
        let pn =
          "SQ-" +
          prefix +
          "-" +
          String(Math.floor(100000 + Math.random() * 900000));
        while (
          store.entities("policies", w).some((p) => p.policy_number === pn)
        )
          pn =
            "SQ-" +
            prefix +
            "-" +
            String(Math.floor(100000 + Math.random() * 900000));
        result.policy_number = pn;
        store.put(
          "policies",
          pn,
          {
            policy_number: pn,
            client_id: c.client_id,
            product,
            status: "pending_payment",
            start_date: s.trip_start || AS_OF,
            end_date: s.trip_end || "2027-09-30",
            premium: quote.price,
            details: s,
          },
          w,
        );
      }
      return result;
    }
    case "renew_policy": {
      const p = policy();
      if (p.status === "cancelled") throw new AppError("not_eligible");
      const q =
        p.product === "ogpo"
          ? ogpoPrice(
              {
                ...p.details,
                region:
                  kb.products.ogpo.pricing.region_by_plate_code[
                    p.details.vehicle_plate.slice(-2)
                  ] || "other",
              },
              store.entities("clients", w),
            )
          : p.product === "casco"
            ? cascoPrice(p.details)
            : null;
      if (q === null) throw new AppError("tariff_unavailable");
      const start =
        p.end_date >= AS_OF
          ? new Date(Date.parse(p.end_date) + 86400000)
              .toISOString()
              .slice(0, 10)
          : AS_OF;
      const end = new Date(Date.parse(start));
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      end.setUTCDate(end.getUTCDate() - 1);
      const result = {
        policy_number: p.policy_number,
        price: q,
        start_date: start,
        end_date: end.toISOString().slice(0, 10),
      };
      if (execute)
        store.put(
          "policies",
          p.policy_number,
          { ...p, ...result, premium: q, status: "pending_payment" },
          w,
        );
      return result;
    }
    case "update_policy": {
      const p = policy();
      activePolicy(p);
      const details = { ...p.details };
      if (c.active === "SC04") {
        if (!s.new_driver_iin) throw new AppError("invalid_input");
        details.drivers_iin = [
          ...new Set([...(details.drivers_iin || []), s.new_driver_iin]),
        ];
      } else {
        if (!s.vehicle_plate) throw new AppError("invalid_input");
        details.vehicle_plate = s.vehicle_plate;
      }
      if (p.product !== "ogpo") throw new AppError("tariff_unavailable");
      const region =
        kb.products.ogpo.pricing.region_by_plate_code[
          String(details.vehicle_plate).slice(-2)
        ] || "other";
      const price = ogpoPrice(
        { ...details, region },
        store.entities("clients", w),
      );
      const result = {
        policy_number: p.policy_number,
        extra_premium: Math.max(0, price - p.premium),
        details,
      };
      if (execute)
        store.put(
          "policies",
          p.policy_number,
          { ...p, premium: Math.max(price, p.premium), details },
          w,
        );
      return result;
    }
    case "cancel_policy": {
      const p = policy();
      activePolicy(p);
      const result = {
        policy_number: p.policy_number,
        refund_amount: refund(p, store.entities("claims", w)),
        refund_time: kb.cancellation.refund_time,
      };
      if (execute)
        store.put(
          "policies",
          p.policy_number,
          { ...p, status: "cancelled" },
          w,
        );
      return result;
    }
    case "create_claim": {
      const p = policy();
      activePolicy(p);
      if (
        !s.incident_date ||
        s.incident_date > AS_OF ||
        !s.incident_description
      )
        throw new AppError("invalid_input");
      const result: any = {
        policy_number: p.policy_number,
        incident_date: s.incident_date,
        incident_description: s.incident_description,
        status: "registered",
      };
      if (execute) {
        if (!c.client_id) {
          if (!s.phone) throw new AppError("phone_required");
          const existing = store
            .entities("clients", w)
            .find((x) => x.phone === s.phone);
          c.client_id = existing?.client_id || newId("C-");
          if (!existing)
            store.put(
              "clients",
              c.client_id!,
              {
                client_id: c.client_id,
                phone: s.phone,
                full_name: "Demo client",
              },
              w,
            );
        }
        result.claim_number =
          "CL-" + String(Math.floor(100000 + Math.random() * 900000));
        while (
          store
            .entities("claims", w)
            .some((x) => x.claim_number === result.claim_number)
        )
          result.claim_number =
            "CL-" + String(Math.floor(100000 + Math.random() * 900000));
        store.put(
          "claims",
          result.claim_number,
          {
            ...result,
            client_id: c.client_id,
            claim_type: c.active === "SC12" ? "ogpo_victim" : p.product,
            next_step: "Submit documents listed in knowledge_base.json",
          },
          w,
        );
      }
      return result;
    }
    case "create_dispute": {
      const x = claim();
      const result: any = {
        claim_number: x.claim_number,
        complaint_text: s.complaint_text,
        review: kb.claims.dispute,
      };
      if (execute) {
        result.ticket_id = newId("D-");
        store.put(
          "tickets",
          result.ticket_id,
          { ...result, client_id: c.client_id },
          w,
        );
      }
      return result;
    }
    case "book_inspection":
    case "book_appointment": {
      if (name === "book_inspection") claim();
      else {
        const p = policy();
        const cv = coverage(p, String(s.doctor_specialty));
        if (!cv.covered) throw new AppError("not_covered");
        if (/referral/i.test(cv.note)) throw new AppError("referral_required");
      }
      if (!s.preferred_date || s.preferred_date < AS_OF)
        throw new AppError("invalid_input");
      const list =
        name === "book_inspection" ? kb.inspection_points : kb.clinics;
      const point = list.find(
        (x: any) =>
          x.city === s.city &&
          (name === "book_inspection" ||
            x.specialties.includes(s.doctor_specialty)),
      );
      if (!point) throw new AppError("no_availability");
      const result: any = {
        clinic_name: point.name || null,
        address: point.address,
        slot_datetime: s.preferred_date + " 09:30",
        mock_schedule: true,
      };
      if (execute) {
        result.booking_id = newId("B-");
        store.put(
          "bookings",
          result.booking_id,
          { ...result, client_id: c.client_id },
          w,
        );
      }
      return result;
    }
    case "check_coverage":
      return coverage(policy(), String(s.service_name));
    case "list_clinics": {
      const list = kb.clinics.filter((x: any) => x.city === s.city);
      if (!list.length) throw new AppError("not_found");
      return { clinics: list };
    }
    case "get_offices": {
      const x = kb.offices.find((x: any) => x.city === s.city);
      if (!x) throw new AppError("not_found");
      return x;
    }
    case "check_payment": {
      const x = store
        .entities("payments", w)
        .find((x) => x.client_id === c.client_id && x.date === s.payment_date);
      if (!x) throw new AppError("not_found");
      return {
        payment_status: x.status,
        amount: x.amount,
        policy_number: x.policy_number,
      };
    }
    case "update_contact": {
      const x = client();
      if (!["phone", "email", "address"].includes(String(s.contact_field)))
        throw new AppError("invalid_input");
      if (
        s.contact_field === "phone" &&
        !/^\+7\d{10}$/.test(String(s.new_value))
      )
        throw new AppError("invalid_input");
      if (
        s.contact_field === "email" &&
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s.new_value))
      )
        throw new AppError("invalid_input");
      if (
        s.contact_field === "phone" &&
        store
          .entities("clients", w)
          .some((y) => y.phone === s.new_value && y.client_id !== x.client_id)
      )
        throw new AppError("invalid_input");
      if (execute)
        store.put(
          "clients",
          x.client_id,
          { ...x, [String(s.contact_field)]: s.new_value },
          w,
        );
      return { updated: s.contact_field, new_value: s.new_value };
    }
    case "resend_documents": {
      const p = policy();
      return {
        sent_to: client().email,
        policy_number: p.policy_number,
        mock_delivery: true,
      };
    }
    case "request_document": {
      policy();
      if (!kb.documents_available[String(s.document_type)])
        throw new AppError("invalid_input");
      return {
        sent_to: s.email,
        delivery: kb.documents_available[String(s.document_type)],
        mock_delivery: true,
      };
    }
    case "send_sms":
      return { sent_to: s.phone || client().phone, mock_delivery: true };
    case "create_callback":
      return {
        phone: s.phone,
        callback_time: s.callback_time,
        mock_callback: true,
      };
    case "create_complaint":
    case "report_fraud": {
      const result = {
        ticket_id: newId(name === "report_fraud" ? "F-" : "T-"),
        text: s.complaint_text || s.fraud_details,
      };
      if (execute)
        store.put(
          "tickets",
          result.ticket_id,
          { ...result, client_id: c.client_id },
          w,
        );
      return result;
    }
    case "kb_lookup":
      return lookup(c.active || "", [], String(s.product_type || "")).facts;
    case "transfer_to_operator":
      return { queue: s.queue || "operator_general" };
    default:
      throw new AppError("action_not_allowed", 403);
  }
}
