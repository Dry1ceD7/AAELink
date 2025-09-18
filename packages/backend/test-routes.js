const Fastify = require('fastify')

const fastify = Fastify({
  logger: true
})

// Test route
fastify.get('/test', async (request, reply) => {
  return { message: 'Test route works!' }
})

// API routes
fastify.register(async function (fastify) {
  fastify.post('/api/auth/login', async (request, reply) => {
    return { success: true, message: 'Login route works!' }
  })
}, { prefix: '/api' })

const start = async () => {
  try {
    await fastify.listen({ port: 3002, host: '0.0.0.0' })
    console.log('Server running on port 3002')
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
