// Server-Sent Events broadcaster — shared between routes and automation runner

const clients = new Set()

function addClient(res) {
  clients.add(res)
}

function removeClient(res) {
  clients.delete(res)
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients) {
    try {
      client.write(payload)
    } catch {
      clients.delete(client)
    }
  }
}

module.exports = { addClient, removeClient, broadcast }
