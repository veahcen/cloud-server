const Router = require("express")
const router = new Router()
const userController = require("../controllers/userController")
const authMiddleware = require("../middleware/authMiddleware")

router.post('/registration', userController.registration)
router.post('/login', userController.login)
router.delete('/delete', authMiddleware, userController.deleteUser)
router.get('/auth', authMiddleware, userController.auth)
router.get('/users', authMiddleware, userController.getAllUsers);

module.exports = router