/**
 * Single registry of all built-in validation rules. Order in this array
 * does not matter — the runner sorts hits at report time.
 */

import { amountRules } from "./amount.js";
import { captureRules } from "./capture.js";
import { idempotencyRules } from "./idempotency.js";
import { keySafetyRules } from "./key-safety.js";
import { methodsRules } from "./methods.js";
import { orderFlowRules } from "./order-flow.js";
import { pciRules } from "./pci.js";
import { webhookHandlerRules } from "./webhook-handler.js";
import { webhookSignatureRules } from "./webhook-signature.js";
import type { Rule } from "../types.js";

export const ALL_RULES: readonly Rule[] = [
  ...webhookSignatureRules,
  ...amountRules,
  ...orderFlowRules,
  ...idempotencyRules,
  ...keySafetyRules,
  ...pciRules,
  ...webhookHandlerRules,
  ...captureRules,
  ...methodsRules,
];
