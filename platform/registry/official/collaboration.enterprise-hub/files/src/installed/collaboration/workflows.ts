// @generated-block-service collaboration/enterprise-hub
import { handleApprovalApproval } from '../../../custom/on_workflow_approved.ts';
import { handleApprovalRejection } from '../../../custom/on_workflow_rejected.ts';

// 内存数据库，用以模拟轻量化编译期的模块化单体数据表现
// 实际 compose 阶段，Prisma 编译会将 enterprise-hub.prisma 合并进 project/ 的主 schema.prisma
export interface WorkflowData {
  id: string;
  name: string;
  tenantId: string;
  steps: Array<{ id: string; role: string; stepOrder: number }>;
  createdAt: Date;
}

export interface ApprovalRequestData {
  id: string;
  title: string;
  status: 'pending' | 'approved' | 'rejected';
  workflowId: string;
  tenantId: string;
  currentStep: number;
  createdAt: Date;
}

const workflowsDb = new Map<string, WorkflowData>();
const requestsDb = new Map<string, ApprovalRequestData>();

/**
 * 1. 创建审批流模板
 */
export async function createWorkflow(
  name: string,
  tenantId: string,
  steps: Array<{ role: string; stepOrder: number }>
): Promise<WorkflowData> {
  const id = `wf-${Math.random().toString(36).substr(2, 9)}`;
  const formattedSteps = steps.map((step, idx) => ({
    id: `step-${id}-${idx}`,
    role: step.role,
    stepOrder: step.stepOrder
  }));

  const workflow: WorkflowData = {
    id,
    name,
    tenantId,
    steps: formattedSteps.sort((a, b) => a.stepOrder - b.stepOrder),
    createdAt: new Date()
  };

  workflowsDb.set(id, workflow);
  return workflow;
}

/**
 * 2. 发起审批申请
 */
export async function submitApproval(
  title: string,
  workflowId: string,
  tenantId: string
): Promise<ApprovalRequestData> {
  const workflow = workflowsDb.get(workflowId);
  if (!workflow) {
    throw new Error(`Workflow template "${workflowId}" not found.`);
  }

  const id = `req-${Math.random().toString(36).substr(2, 9)}`;
  const request: ApprovalRequestData = {
    id,
    title,
    status: 'pending',
    workflowId,
    tenantId,
    currentStep: 1,
    createdAt: new Date()
  };

  requestsDb.set(id, request);
  return request;
}

/**
 * 3. 签署批准审批步骤
 */
export async function approveStep(
  requestId: string,
  actorRole: string
): Promise<ApprovalRequestData> {
  const request = requestsDb.get(requestId);
  if (!request) {
    throw new Error(`Approval request "${requestId}" not found.`);
  }

  if (request.status !== 'pending') {
    throw new Error(`Approval request is already completed with status: ${request.status}`);
  }

  const workflow = workflowsDb.get(request.workflowId);
  if (!workflow) {
    throw new Error(`Workflow template for request "${requestId}" is missing.`);
  }

  // 获取当前审批步骤对应的角色
  const currentStepDef = workflow.steps.find(s => s.stepOrder === request.currentStep);
  if (!currentStepDef) {
    throw new Error(`Workflow step order ${request.currentStep} definition is missing.`);
  }

  // 严格的角色防越权判定
  if (currentStepDef.role !== actorRole) {
    throw new Error(
      `Permission Denied: Actor with role "${actorRole}" cannot approve workflow step requiring "${currentStepDef.role}".`
    );
  }

  // 判断是否还有下一步
  const hasNext = workflow.steps.some(s => s.stepOrder === request.currentStep + 1);
  if (hasNext) {
    request.currentStep += 1;
  } else {
    // 审批全部通过
    request.status = 'approved';
    
    // 异步触发平台缝合的 Custom Slot 成功回调，传递审批完整实体
    try {
      await handleApprovalApproval(request as any);
    } catch (e: any) {
      console.warn(`[enterprise-hub] handleApprovalApproval slot callback failed: ${e.message}`);
    }
  }

  requestsDb.set(requestId, request);
  return request;
}

/**
 * 4. 驳回审批
 */
export async function rejectStep(
  requestId: string,
  actorRole: string
): Promise<ApprovalRequestData> {
  const request = requestsDb.get(requestId);
  if (!request) {
    throw new Error(`Approval request "${requestId}" not found.`);
  }

  if (request.status !== 'pending') {
    throw new Error(`Approval request is already completed with status: ${request.status}`);
  }

  request.status = 'rejected';

  // 触发平台缝合的 Custom Slot 驳回回调
  try {
    await handleApprovalRejection(request as any);
  } catch (e: any) {
    console.warn(`[enterprise-hub] handleApprovalRejection slot callback failed: ${e.message}`);
  }

  requestsDb.set(requestId, request);
  return request;
}

/**
 * 获取请求详情
 */
export async function getApprovalStatus(requestId: string): Promise<ApprovalRequestData | undefined> {
  return requestsDb.get(requestId);
}

/**
 * 清空临时缓存数据库 (调试与测试用)
 */
export function clearMockDatabase(): void {
  workflowsDb.clear();
  requestsDb.clear();
}
