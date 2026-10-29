export async function readDecisionResponse(response, onSnapshot) {
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Could not analyze this stock.');
  }
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const data = await response.json();
    onSnapshot(data);
    return data;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult;
  function consume(line) {
    if (!line.trim()) return;
    const item = JSON.parse(line);
    if (item.type === 'error') throw new Error(item.error || 'The remaining checks could not finish.');
    if (item.type === 'snapshot' || item.type === 'result') {
      if (!item.data?.result?.answers) throw new Error('Incomplete signal response.');
      onSnapshot(item.data);
      if (item.type === 'result') finalResult = item.data;
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) consume(line);
      if (done) { consume(buffer); break; }
    }
    if (!finalResult) throw new Error('Connection interrupted. Initial signals are still shown.');
    return finalResult;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
