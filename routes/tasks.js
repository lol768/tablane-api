const router = require('express').Router()
const { wrapAsync, isLoggedIn, hasPermission } = require('../middleware')
const Task = require('../models/task')
const User = require('../models/user')
const Board = require('../models/board')
const Activity = require('../models/activity')
const { addActivity } = require('../controllers/activities')
const { addWatcher } = require('../utils/addWatcher')

// add new watcher to task
router.post(
    '/watcher/:taskId',
    isLoggedIn,
    hasPermission('MANAGE:TASK'),
    wrapAsync(async (req, res) => {
        const { taskId } = req.params
        const { userId } = req.body
        const task = await Task.findById(taskId)
        const user = await User.findById(userId)

        task.watcher.addToSet(userId)
        await addActivity(task, req.user, { type: 'add_watcher' }, userId)

        const io = req.app.get('socketio')
        io.to(task.board.toString())
            .except(req.user._id.toString())
            .emit(task.board, {
                event: 'addWatcher',
                id: task.board,
                body: { task, user: { username: user.username, _id: user._id } }
            })

        await task.save()
        res.json({ success: true, message: 'OK' })
    })
)

// get filtered tasks
router.post(
    '/getAssignedTasks/:workspaceId',
    isLoggedIn,
    hasPermission('READ:PUBLIC'),
    wrapAsync(async (req, res) => {
        const { workspaceId } = req.params
        const { filter } = req.body

        const tasks = await Task.find({
            workspace: workspaceId,
            ...filter
        }).populate([
            {
                path: 'watcher',
                select: 'username'
            },
            {
                path: 'history'
            },
            {
                path: 'comments',
                populate: 'replies'
            },
            {
                path: 'workspace',
                select: ['name', 'id']
            },
            {
                path: 'board',
                select: ['space', 'name'],
                populate: {
                    path: 'space',
                    select: 'name'
                }
            }
        ])

        res.json(tasks)
    })
)

// remove watcher from task
router.delete(
    '/watcher/:taskId',
    isLoggedIn,
    hasPermission('MANAGE:TASK'),
    wrapAsync(async (req, res) => {
        const { taskId } = req.params
        const { userId } = req.body
        const task = await Task.findById(taskId)
        const user = await User.findById(userId)

        task.watcher.remove(userId)
        await addActivity(task, req.user, { type: 'remove_watcher' }, userId)

        const io = req.app.get('socketio')
        io.to(task.board.toString())
            .except(req.user._id.toString())
            .emit(task.board, {
                event: 'removeWatcher',
                id: task.board,
                body: { task, user: { username: user.username, _id: user._id } }
            })

        await task.save()
        res.json({ success: true, message: 'OK' })
    })
)

// edit task options
router.patch(
    '/:boardId/:taskId',
    isLoggedIn,
    hasPermission('MANAGE:TASK'),
    wrapAsync(async (req, res) => {
        const { boardId, taskId } = req.params
        const { column, value, type } = req.body
        const task = await Task.findById(taskId)

        addWatcher(task, req.user)

        // edit name
        if (type === 'name') {
            await addActivity(task, req.user, {
                type: 'name',
                from: task.name,
                to: value
            })
            task.name = value
        } else if (type === 'description') {
            task.description = value
        }

        const options = task.options
        const option = options.find(x => x.column.toString() === column)

        if (type === 'status') {
            if (option?.value !== value) {
                await addActivity(task, req.user, {
                    type: 'attribute',
                    field: column,
                    from: option?.value,
                    to: value
                })
            }
            if (option) option.value = value
            else options.push({ column, value })
        } else if (type === 'text') {
            if (option) option.value = value
            else options.push({ column, value })
        } else if (type === 'person') {
            if (option) option.value = value
            else options.push({ column, value })
        }

        const io = req.app.get('socketio')
        io.to(boardId).except(req.user._id.toString()).emit(boardId, {
            event: 'editOptionsTask',
            id: boardId,
            body: { column, value, type, taskId }
        })

        await task.save()
        res.json({ success: true, message: 'OK' })
    })
)

// clear status label
router.delete(
    '/:boardId/:taskId/:optionId',
    isLoggedIn,
    hasPermission('MANAGE:TASK'),
    wrapAsync(async (req, res) => {
        const { boardId, taskId, optionId } = req.params
        const task = await Task.findById(taskId)

        addWatcher(task, req.user)

        const options = task.options
        const optionIndex = options.indexOf(
            options.find(x => x.column.toString() === optionId)
        )

        if (options[optionIndex]) {
            await addActivity(task, req.user, {
                type: 'attribute',
                field: optionId,
                from: options[optionIndex].value,
                to: null
            })
        }

        if (optionIndex >= 0) options.splice(optionIndex, 1)

        const io = req.app.get('socketio')
        io.to(boardId).except(req.user._id.toString()).emit(boardId, {
            event: 'clearStatusTask',
            id: boardId,
            body: { taskId, optionId }
        })

        await task.save()
        res.json({ success: true, message: 'OK' })
    })
)

// add subtask to task
router.post(
    '/:boardId/:taskId',
    isLoggedIn,
    hasPermission('MANAGE:TASK'),
    wrapAsync(async (req, res) => {
        const { boardId, taskId } = req.params
        const { name, taskGroupId, _id } = req.body
        const task = await Task.findById(taskId)

        const newTaskActivity = new Activity({
            type: 'activity',
            author: req.user,
            timestamp: new Date().getTime(),
            change: {
                type: 'creation'
            }
        })

        const subtask = new Task({
            _id,
            name,
            options: [],
            board: task.board,
            description: '',
            watcher: task.watcher,
            workspace: task.workspace,
            parentTask: task,
            level: task.level + 1,
            history: [newTaskActivity]
        })

        // only add author if not duplicated
        addWatcher(subtask, req.user)

        task.subtasks.push(subtask)

        // const io = req.app.get('socketio')
        // io.to(boardId)
        //     .except(req.user._id.toString())
        //     .emit(boardId, {
        //         event: 'addTask',
        //         id: boardId,
        //         body: {
        //             newTaskName: name,
        //             taskGroupId,
        //             _id,
        //             author: req.user.username
        //         }
        //     })

        await task.save()
        await subtask.save()
        await newTaskActivity.save()
        res.json({ success: true, message: 'OK' })
    })
)

// drag and drop task sorting
router.patch(
    '/:boardId',
    isLoggedIn,
    hasPermission('MANAGE:TASK'),
    wrapAsync(async (req, res) => {
        const { boardId } = req.params
        const { taskId, newParentTask, index, overId } = req.body
        const board = await Board.findById(boardId)
        const task = await Task.findById(taskId)

        // remove from old location
        if (task.parentTask) {
            const oldParent = await Task.findById(task.parentTask)
            oldParent.subtasks = oldParent.subtasks.filter(
                x => x.toString() !== task._id.toString()
            )
            await oldParent.save()
        } else {
            board.tasks = board.tasks.filter(
                x => x.toString() !== task._id.toString()
            )
        }

        task.parentTask = newParentTask

        // add to new location
        if (newParentTask) {
            const newParent = await Task.findById(newParentTask)

            const newIndex = newParent.subtasks.findIndex(
                x => x._id.toString() === overId
            )
            if (newIndex === -1) {
                newParent.subtasks.push(task)
            } else {
                newParent.subtasks.splice(newIndex, 0, task)
            }

            await newParent.save()
        } else {
            const newIndex = board.tasks.findIndex(
                x => x._id.toString() === overId
            )
            if (newIndex === -1) {
                board.tasks.push(task)
            } else {
                board.tasks.splice(newIndex, 0, task)
            }
        }

        await task.save()
        await board.save()
        res.json({ success: true, message: 'OK' })
    })
)

// add new Task
router.post(
    '/:boardId',
    isLoggedIn,
    hasPermission('CREATE:TASK'),
    wrapAsync(async (req, res) => {
        const { boardId } = req.params
        const { name, taskGroupId, _id } = req.body
        const board = await Board.findById(boardId).populate([
            'tasks',
            'workspace'
        ])

        const newTaskActivity = new Activity({
            type: 'activity',
            author: req.user,
            timestamp: new Date().getTime(),
            change: {
                type: 'creation'
            }
        })

        const task = new Task({
            _id,
            name,
            options: [],
            board: board,
            description: '',
            watcher: [req.user],
            workspace: board.workspace,
            comments: [],
            history: [newTaskActivity]
        })

        newTaskActivity.task = task

        if (board.groupBy) {
            task.options.push({
                column: board.groupBy,
                value: taskGroupId
            })
        }

        board.tasks.push(task)

        const io = req.app.get('socketio')
        io.to(boardId)
            .except(req.user._id.toString())
            .emit(boardId, {
                event: 'addTask',
                id: boardId,
                body: {
                    newTaskName: name,
                    taskGroupId,
                    _id,
                    author: req.user.username
                }
            })

        await task.save()
        await board.save()
        await newTaskActivity.save()
        res.json({ success: true, message: 'OK' })
    })
)

// delete a task
router.delete(
    '/:boardId/:taskId',
    isLoggedIn,
    hasPermission('DELETE:TASK'),
    wrapAsync(async (req, res) => {
        const { boardId, taskId } = req.params
        const task = await Task.findById(taskId).populate([
            'board',
            'parentTask'
        ])

        if (task.level === 0) {
            task.board.tasks = task.board.tasks.filter(
                x => x.toString() !== task._id.toString()
            )
            await task.board.save()
        } else {
            task.parentTask.subtasks = task.parentTask.subtasks.filter(
                x => x.toString() !== task._id.toString()
            )

            await task.parentTask.save()
        }

        const io = req.app.get('socketio')
        io.to(boardId).except(req.user._id.toString()).emit(boardId, {
            event: 'deleteTask',
            id: boardId,
            body: { taskId }
        })

        await Task.findByIdAndDelete(taskId)
        res.json({ success: true, message: 'OK' })
    })
)

module.exports = router
