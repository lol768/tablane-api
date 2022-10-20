const Board = require('./models/board')
const Workspace = require('./models/workspace')
const { verify } = require('jsonwebtoken')
const AppError = require('./HttpError')
const User = require('./models/user')

const wrapAsync = func => {
    return async (req, res, next) => {
        try {
            await func(req, res, next)
        } catch (e) {
            next(e)
        }
    }
}

module.exports.hasPerms = (workspace, user, permission) => {
    const member = workspace.members.find(
        x => x.user.toString() === user._id.toString()
    )
    if (member.isOwner) return true
    return member.role.permissions.includes(permission)
}

const checkPerms = async req => {
    const { boardId, workspaceId } = req.params
    if (boardId) {
        const board = await Board.findById(boardId).populate({
            path: 'workspace',
            model: 'Workspace',
            select: 'members'
        })

        const user = board.workspace.members.find(
            x => x.user.toString() === req.user._id.toString()
        )
        return user.role
    } else if (workspaceId) {
        let workspace
        if (workspaceId.length > 4) {
            workspace = await Workspace.findById(workspaceId)
        } else {
            workspace = await Workspace.findOne({ id: workspaceId })
        }

        const user = workspace.members.find(
            x => x.user.toString() === req.user._id.toString()
        )
        return user.role
    }
}

module.exports.isLoggedIn = wrapAsync(async (req, res, next) => {
    const authorization = req.headers['authorization']
    if (!authorization) throw new AppError('Invalid access token', 403)

    try {
        const token = authorization.split(' ')[1]
        const payload = verify(token, process.env.ACCESS_TOKEN_SECRET)
        const user = await User.findById(payload.user._id)
        req['user'] = {
            username: user.username,
            workspaces: user.workspaces,
            _id: user._id,
            assignedTasks: user.assignedTasks,
            newNotifications: user.newNotifications
        }
    } catch (err) {
        throw new AppError('Invalid access token', 403)
    }
    next()
})

module.exports.hasAdminPerms = wrapAsync(async (req, res, next) => {
    const role = await checkPerms(req)
    if (role === 'owner' || role === 'admin') next()
    else res.status(403).send('Forbidden - no admin perms')
})

module.exports.hasWritePerms = wrapAsync(async (req, res, next) => {
    const role = await checkPerms(req)
    if (role === 'owner' || role === 'admin' || role === 'member') next()
    else res.status(403).send('Forbidden - no write perms')
})

module.exports.hasReadPerms = wrapAsync(async (req, res, next) => {
    const role = await checkPerms(req)
    if (
        role === 'owner' ||
        role === 'admin' ||
        role === 'member' ||
        role === 'guest'
    )
        next()
    else res.status(403).send('Forbidden - no read perms')
})

module.exports.wrapAsync = wrapAsync
