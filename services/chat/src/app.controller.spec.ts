import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmModule } from './llm/llm.module';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      imports: [LlmModule],
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return { ok: true }', () => {
      expect(appController.getHealth()).toEqual({ ok: true });
    });
  });

  describe('hello', () => {
    it('should return a message with APP_NAME', () => {
      const result = appController.getHello();
      expect(result.message).toContain('dream-llm');
    });
  });
});
