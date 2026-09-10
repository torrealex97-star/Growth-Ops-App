-- El email de login de un closer (users.email) puede ser distinto del email con el que
-- tiene configurada su cuenta de Calendly (ej: Jesus Peña usa un gmail personal para
-- entrar a la app pero jesus.p@iawinners.es en Calendly). El webhook y la creación manual
-- de agendas necesitan poder resolver el closer por ESE email también.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS calendly_email TEXT;

UPDATE public.users
SET calendly_email = 'jesus.p@iawinners.es'
WHERE id = 'f0f8bbee-70b1-4480-8e0d-515a661d7aae';
