import { describe, it, expect } from 'vitest';
import { User, UserCreateInput } from '../schemas/user';
import { LoginInput, LoginResponse } from '../schemas/auth';
import { TemplateVariable, PromptTemplate, PromptTemplateCreateInput } from '../schemas/template';

describe('user/auth/template schemas', () => {
  it('User 必填字段', () => {
    expect(
      User.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        username: 'admin',
        email: 'a@b.cn',
        role: 'admin',
      }).success,
    ).toBe(true);
  });

  it('User username 最少 2 字符', () => {
    expect(
      User.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        username: 'a',
        email: 'a@b.cn',
        role: 'operator',
      }).success,
    ).toBe(false);
  });

  it('UserCreateInput password 最少 6 字符', () => {
    expect(
      UserCreateInput.safeParse({
        username: 'tester',
        email: 'a@b.cn',
        password: '12345',
      }).success,
    ).toBe(false);
  });

  it('LoginInput 必含 username/password', () => {
    expect(LoginInput.safeParse({ username: 'a', password: 'b' }).success).toBe(true);
  });

  it('LoginResponse 必含 token + user', () => {
    expect(
      LoginResponse.safeParse({
        token: 'jwt',
        user: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          username: 'admin',
          email: 'a@b.cn',
          role: 'admin',
        },
      }).success,
    ).toBe(true);
  });

  it('TemplateVariable.type 五值枚举：text | textarea | select | number | boolean', () => {
    expect(TemplateVariable.shape.type.options).toEqual([
      'text',
      'textarea',
      'select',
      'number',
      'boolean',
    ]);
  });

  it('TemplateVariable textarea 合法', () => {
    expect(
      TemplateVariable.safeParse({ key: 'desc', label: '描述', type: 'textarea' }).success,
    ).toBe(true);
  });

  it('PromptTemplate 接受空 variables 数组', () => {
    expect(
      PromptTemplate.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'demo',
        variables: [],
        system_prompt: 'sys',
        user_prompt_template: 'tpl',
      }).success,
    ).toBe(true);
  });

  it('PromptTemplateCreateInput 不需要 id', () => {
    expect(
      PromptTemplateCreateInput.safeParse({
        name: 'demo',
        variables: [],
        system_prompt: 'sys',
        user_prompt_template: 'tpl',
      }).success,
    ).toBe(true);
  });
});
