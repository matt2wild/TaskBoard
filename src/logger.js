const isDev = process.env.NODE_ENV !== 'production'

const prefix = '[TaskBoard]'

export const log = (...args) => {
  if (isDev) console.log(prefix, ...args)
}

export const warn = (...args) => {
  if (isDev) console.warn(prefix, ...args)
}

// Errors always surface regardless of environment
export const error = (...args) => {
  console.error(prefix, ...args)
}
