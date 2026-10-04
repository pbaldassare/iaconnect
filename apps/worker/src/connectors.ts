import { type Connector, type ConnectorContext, ConnectorError } from "@ia-connect/core";
import { type ConnectionRow, toConnectionRecord } from "./db/repo.ts";
import type { Deps } from "./deps.ts";

export function requireConnector(deps: Deps, connection: ConnectionRow): Connector {
  const connector = deps.connectors.get(connection.connector_type);
  if (!connector) {
    throw new ConnectorError(`Il connettore "${connection.connector_type}" non è disponibile.`, {
      retryable: false,
      code: "unknown_connector",
    });
  }
  return connector;
}

/** Context handed to a connector: decrypted secrets, clock, fetch. Secrets stay out of the logs. */
export async function connectorContext(deps: Deps, connection: ConnectionRow): Promise<ConnectorContext> {
  const secrets = await deps.secrets.read(connection.id);
  const scope = { connectionId: connection.id, connector: connection.connector_type };
  return {
    connection: toConnectionRecord(connection),
    secrets,
    fetch: deps.fetch,
    now: deps.now,
    logger: {
      info: (message, data) => deps.logger.info(message, { ...data, ...scope }),
      warn: (message, data) => deps.logger.warn(message, { ...data, ...scope }),
      error: (message, data) => deps.logger.error(message, { ...data, ...scope }),
    },
    saveSecrets: (next) => deps.secrets.write(connection.id, next),
    env: deps.config.env,
  };
}

/** Runs one of the standard actions of a connector, validating the input with its schema. */
export async function runAction<O = unknown>(
  deps: Deps,
  connection: ConnectionRow,
  actionKey: string,
  input: unknown,
): Promise<O> {
  const connector = requireConnector(deps, connection);
  const action = connector.actions[actionKey];
  if (!action) {
    throw new ConnectorError(`Il connettore "${connector.name}" non offre l'azione "${actionKey}".`, {
      retryable: false,
      code: "unknown_action",
    });
  }
  const parsed = action.input.parse(input);
  return (await action.execute(await connectorContext(deps, connection), parsed)) as O;
}
