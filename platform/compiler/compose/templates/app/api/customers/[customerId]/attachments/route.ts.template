import { NextResponse } from 'next/server';
import { addCustomerAttachment, listCustomerAttachments } from '../../../../../src/installed/file/customer-attachments.ts';
import { getCurrentSession } from '../../../../../lib/session.ts';
import { getDatabase } from '../../../../../lib/store.ts';

interface AttachmentRouteContext {
  params: Promise<{ customerId: string }>;
}

export async function GET(_request: Request, context: AttachmentRouteContext) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const customerId = Number(params.customerId);
    const attachments = listCustomerAttachments(getDatabase(), session, customerId);
    return NextResponse.json({ attachments });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid attachment request' }, { status: 400 });
  }
}

export async function POST(request: Request, context: AttachmentRouteContext) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated session' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const customerId = Number(params.customerId);
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const attachment = addCustomerAttachment(getDatabase(), session, {
      customerId,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      contentText: await file.text()
    });
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid attachment request' }, { status: 400 });
  }
}
