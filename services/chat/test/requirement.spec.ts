import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('RequirementController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('POST /requirement/extract — 应返回结构化抽取结果', async () => {
    const response = await request(app.getHttpServer())
      .post('/requirement/extract')
      .send({ input: '用户注册时必须绑定手机号，密码至少8位' })
      .expect(201);

    expect(response.body).toHaveProperty('action');
    expect(response.body).toHaveProperty('constraints');
    expect(response.body).toHaveProperty('entities');
    expect(Array.isArray(response.body.constraints)).toBe(true);
    expect(Array.isArray(response.body.entities)).toBe(true);

    expect(response.body.action).toBeTruthy();
  });

  it('POST /requirement/extract — 空 input 应返回 400', async () => {
    await request(app.getHttpServer())
      .post('/requirement/extract')
      .send({ input: '' })
      .expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
