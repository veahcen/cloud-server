function staticPath(path) {
  return function cors(req, res, next) {
    req.staticPath = path
    next()
}
}

module.exports = staticPath