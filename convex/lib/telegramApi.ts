const BASE_URL = "https://api.telegram.org/bot";
const FILE_BASE_URL = "https://api.telegram.org/file/bot";

type TelegramResponse = Record<string, unknown>;

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  options?: {
    replyToMessageId?: number;
    messageThreadId?: number;
    parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  },
): Promise<TelegramResponse> {
  const url = `${BASE_URL}${token}/sendMessage`;

  const body: TelegramResponse = {
    chat_id: chatId,
    text: text,
  };

  if (options?.messageThreadId) {
    body.message_thread_id = options.messageThreadId;
  }

  if (options?.replyToMessageId) {
    body.reply_parameters = {
      message_id: options.replyToMessageId,
    };
  }

  if (options?.parseMode) {
    body.parse_mode = options.parseMode;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<TelegramResponse>;
}

export async function sendChatAction(
  token: string,
  chatId: number,
  action: "typing" | "upload_document" = "typing",
  messageThreadId?: number,
): Promise<void> {
  const url = `${BASE_URL}${token}/sendChatAction`;

  const body: TelegramResponse = {
    chat_id: chatId,
    action,
  };

  if (messageThreadId) {
    body.message_thread_id = messageThreadId;
  }

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function setWebhook(
  token: string,
  webhookUrl: string,
  secret: string,
): Promise<TelegramResponse> {
  const url = `${BASE_URL}${token}/setWebhook`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message"],
      max_connections: 40,
    }),
  });

  return response.json() as Promise<TelegramResponse>;
}

export async function getFile(
  token: string,
  fileId: string,
): Promise<{ file_path?: string; file_size?: number }> {
  const url = `${BASE_URL}${token}/getFile`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    ok?: boolean;
    result?: { file_path?: string; file_size?: number };
  };

  return data.result ?? {};
}

export async function downloadTelegramFile(
  token: string,
  filePath: string,
): Promise<{ bytes: Uint8Array; contentType?: string }> {
  const url = `${FILE_BASE_URL}${token}/${filePath}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram file download error: ${response.status} - ${error}`);
  }

  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? undefined;
  return { bytes: new Uint8Array(buffer), contentType };
}
