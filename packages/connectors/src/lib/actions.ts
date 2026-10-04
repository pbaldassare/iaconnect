import { type ActionDefinition, type ConnectorContext, ConnectorError } from "@ia-connect/core";
import type { z } from "zod";
import { parseInput } from "./http.ts";

/** Builds an action that validates its input before running. */
export function defineAction<S extends z.ZodType, O>(definition: {
  key: string;
  title: string;
  input: S;
  execute(context: ConnectorContext, input: z.output<S>): Promise<O>;
}): ActionDefinition<z.output<S>, O> {
  return {
    key: definition.key,
    title: definition.title,
    input: definition.input as unknown as z.ZodType<z.output<S>>,
    // async: invalid input must reject the promise, never throw synchronously.
    execute: async (context, input) => definition.execute(context, parseInput(definition.input, input)),
  };
}

/** Standard action a connector must expose but cannot perform. */
export function unsupportedAction<S extends z.ZodType>(
  key: string,
  title: string,
  input: S,
  service: string,
): ActionDefinition<z.output<S>, never> {
  return defineAction({
    key,
    title,
    input,
    execute: async () => {
      throw new ConnectorError(`${service}: "${key}" non supportato da questo collegamento`, {
        retryable: false,
        code: "unsupported",
      });
    },
  });
}
