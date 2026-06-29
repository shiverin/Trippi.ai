import { PendingTodosController } from './pending-todos.controller';
import { TodoController } from './todo.controller';
import { TodoService } from './todo.service';
import { Module } from '@nestjs/common';

/** To-do domain (S3 — Phase 2 trip sub-domain). Registered in AppModule. */
@Module({
  controllers: [TodoController, PendingTodosController],
  providers: [TodoService],
})
export class TodoModule {}
